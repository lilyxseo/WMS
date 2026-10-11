import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFonnteWebhook, parseInventoryMessage, formatInventoryReply } from '../supabase/functions/whatsapp-fonnte/handler.js';
import { parseAdvancedCommand } from '../supabase/functions/whatsapp-fonnte/commands.js';
import { SEARCH_MENU, renderMenu, resolveMenu } from '../supabase/functions/whatsapp-fonnte/menu.js';
import { transactionMatches, searchTransactions } from '../supabase/functions/whatsapp-fonnte/transactions.js';

const env = {
  FONNTE_TOKEN: 'test-token', FONNTE_WEBHOOK_SECRET: 'test-secret',
  WHATSAPP_ALLOWED_NUMBERS: '081234567890',
  SUPABASE_URL: 'https://test.supabase.co', WMS_SUPABASE_SECRET_KEY: 'sb_secret_test',
};
function request(payload, secret = 'test-secret') {
  return new Request(`https://wms.test/api/whatsapp/fonnte?secret=${secret}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}
test('commands restrict searches to the requested field', () => {
  assert.deepEqual(parseInventoryMessage('SKU 00123'), { query: '00123', fields: ['sku'] });
  assert.deepEqual(parseInventoryMessage('nama barang Kabel'), { query: 'kabel', fields: ['nama_barang'] });
  assert.deepEqual(parseInventoryMessage('lokasi A-01').fields, ['lokasi_bulky']);
  assert.equal(parseInventoryMessage('bantuan'), null);
  assert.throws(() => parseInventoryMessage('sku A'), /minimal/);
});
test('unconfigured and unauthorized webhooks never access external services', async () => {
  const forbidden = () => { throw new Error('unexpected fetch'); };
  assert.equal((await handleFonnteWebhook({ request: request({}), env: {} }, forbidden)).status, 503);
  assert.equal((await handleFonnteWebhook({ request: request({}, 'wrong'), env }, forbidden)).status, 401);
  for (const payload of [{ sender: '628999', message: 'sku ABC' }, { sender: 'group@g.us', message: 'sku ABC' }, { sender: '6281234567890', message: 'sku ABC', isGroup: true }, { sender: '6281234567890', message: 'sku ABC', fromMe: true }]) {
    assert.deepEqual(await (await handleFonnteWebhook({ request: request(payload), env }, forbidden)).json(), { success: true, ignored: true });
  }
});
test('webhook queries all stock tables and sends only inventory results to authorized sender', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://api.fonnte.com/send') return Response.json({ status: true });
    if (!url.includes('inventory_barang_')) assert.match(url, /or=\(sku\.ilike/);
    assert.doesNotMatch(url, /nama_barang\.ilike/);
    return Response.json([{ sku: '00123', nama_barang: 'Kabel', lokasi_bulky: 'A-01', stok_akhir: 7 }]);
  };
  const response = await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'sku 00123' }), env }, fetchFn);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 6);
  const send = calls.find(call => call.url.endsWith('/send'));
  assert.equal(send.options.headers.Authorization, 'test-token');
  assert.equal(send.options.body.get('target'), '6281234567890');
  assert.match(send.options.body.get('message'), /SKU: 00123/);
  assert.match(send.options.body.get('message'), /Stok: 7/);
  assert.match(send.options.body.get('message'), /Sumber: BULKY/);
  assert.doesNotMatch(send.options.body.get('message'), /sb_secret/);
});
test('database failure produces an honest reply and provider rejection fails webhook', async () => {
  const fetchFn = async (url, options) => {
    if (url.endsWith('/send')) {
      assert.match(options.body.get('message'), /belum dapat diakses/);
      return Response.json({ status: false });
    }
    return Response.json({ message: 'private diagnostic' }, { status: 500 });
  };
  assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'cari kabel' }), env }, fetchFn)).status, 502);
});
test('empty and truncated replies accurately describe results', () => {
  assert.match(formatInventoryReply([]), /tidak ditemukan/);
  assert.match(formatInventoryReply(Array.from({ length: 11 }, () => ({ source: 'RPL' }))), /10 baris pertama/);
});
test('form-encoded webhook payload is supported', async () => {
  const req = new Request('https://wms.test/api/whatsapp/fonnte', {
    method: 'POST', headers: { 'X-Webhook-Secret': 'test-secret' },
    body: new URLSearchParams({ sender: '6281234567890', message: 'bantuan' }),
  });
  const fetchFn = async (url, options) => {
    assert.equal(url, 'https://api.fonnte.com/send');
    assert.match(options.body.get('message'), /cari kabel A-01/);
    return Response.json({ status: true });
  };
  assert.equal((await handleFonnteWebhook({ request: req, env }, fetchFn)).status, 200);
});

test('Edge Function rejects non-POST requests and invalid JSON objects', async () => {
  const forbidden = () => { throw new Error('unexpected fetch'); };
  assert.equal((await handleFonnteWebhook({ request: new Request('https://wms.test/'), env }, forbidden)).status, 405);
  assert.equal((await handleFonnteWebhook({ request: request(null), env }, forbidden)).status, 400);
});

test('Edge Function uses Supabase built-in service role when no custom key is set', async () => {
  const fallbackEnv = { ...env, WMS_SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: 'test-service-role' };
  const fetchFn = async (url, options) => {
    if (url.endsWith('/send')) return Response.json({ status: true });
    assert.equal(options.headers.apikey, 'test-service-role');
    return Response.json([]);
  };
  assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'sku 00123' }), env: fallbackEnv }, fetchFn)).status, 200);
});

test('combined command requires each named field and validates options', () => {
  const command = parseAdvancedCommand('cari sku=00123; nama=kabel; lokasi=A-01; sumber=RPL; stok=ada; halaman=2');
  assert.equal(command.page, 2);
  assert.equal(command.source, 'RPL');
  assert.equal(command.stock, 'ada');
  assert.deepEqual(command.filters.map(item => item.fields), [['sku'], ['nama_barang'], ['lokasi_bulky']]);
  assert.equal(command.filters[0].query, '00123');
  assert.doesNotMatch(command.command, /halaman=/);
  for (const text of ['sku ABC; halaman=0', 'sku ABC; halaman=101', 'sku ABC; sumber=unknown', 'sku ABC; stok=mungkin', 'sku ABC; salah=x', 'sku ABC; halaman=2; halaman=3', 'cari sumber=RPL']) {
    assert.throws(() => parseAdvancedCommand(text));
  }
});

test('combined lookup scopes source, stock, offset, and every search field', async () => {
  let queries = 0;
  const fetchFn = async (url, options) => {
    if (url.endsWith('/send')) {
      const reply = options.body.get('message');
      assert.match(reply, /Halaman 2/);
      assert.match(reply, /halaman=3/);
      assert.doesNotMatch(reply, /halaman=2;/);
      assert.match(reply, /WIB/);
      assert.match(reply, /Sumber: RPL/);
      return Response.json({ status: true });
    }
    queries++;
    assert.match(url, /inventory_rpl\?/);
    assert.match(url, /or=\(nama_barang\.ilike/);
    assert.match(url, /or=\(lokasi_bulky\.ilike/);
    assert.match(url, /stok_akhir=gt\.0/);
    assert.match(url, /offset=3&limit=4/);
    return Response.json(Array.from({ length: 4 }, (_, i) => ({ sku: `SKU${i}`, nama_barang: 'Kabel', lokasi_bulky: 'A-01', stok_akhir: 7, synced_at: '2026-10-11T00:00:00Z' })));
  };
  const response = await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'cari nama=kabel; lokasi=A-01; sumber=RPL; stok=ada; halaman=2' }), env }, fetchFn);
  assert.equal(response.status, 200);
  assert.equal(queries, 1);
});

test('detail lookup matches a complete SKU and escapes wildcard characters', async () => {
  const fetchFn = async (url, options) => {
    if (url.endsWith('/send')) {
      assert.match(options.body.get('message'), /tidak ditemukan/);
      return Response.json({ status: true });
    }
    const query = new URL(url).searchParams;
    if (!url.includes('inventory_barang_')) assert.equal(query.get('sku'), 'ilike.00\\%\\_\\*');
    assert.equal(query.has('or'), false);
    return Response.json([]);
  };
  assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'detail 00%_*' }), env }, fetchFn)).status, 200);
});

test('pagination preserves all three sources without summing or skipping rows', async () => {
  const replies = [];
  const fetchFn = async (url, options) => {
    if (url.endsWith('/send')) {
      replies.push(options.body.get('message'));
      return Response.json({ status: true });
    }
    const query = new URL(url).searchParams;
    const offset = Number(query.get('offset'));
    return Response.json(Array.from({ length: offset ? 1 : 4 }, (_, i) => ({ sku: `ITEM${offset + i}`, nama_barang: 'Kabel', lokasi_bulky: 'A-01', stok_akhir: 2 })));
  };
  for (const message of ['barang kabel', 'barang kabel; halaman=2']) {
    assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message }), env }, fetchFn)).status, 200);
  }
  for (const reply of replies) for (const source of ['Kartu Stock', 'RPL', 'BULKY']) assert.ok(reply.includes(`Sumber: ${source}`));
  assert.match(replies[0], /barang kabel; halaman=2/);
  assert.doesNotMatch(replies[0], /SKU: ITEM3/);
  assert.match(replies[1], /SKU: ITEM3/);
  assert.match(replies[1], /Akhir hasil/);
  assert.doesNotMatch(replies[1], /SKU: ITEM2/);
});

test('invalid advanced commands send guidance without database access', async () => {
  const fetchFn = async (url, options) => {
    assert.equal(url, 'https://api.fonnte.com/send');
    assert.match(options.body.get('message'), /Halaman harus/);
    return Response.json({ status: true });
  };
  assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'sku ABC; halaman=-1' }), env }, fetchFn)).status, 200);
});

test('menu registry automatically includes every command and its guidance', () => {
  for (const entry of SEARCH_MENU) {
    assert.ok(renderMenu().includes(entry.title));
    assert.ok(renderMenu().includes(entry.example));
    assert.ok(resolveMenu(entry.id).includes(entry.example));
    assert.equal(resolveMenu(`menu ${entry.command}`), resolveMenu(entry.id));
  }
  const extra = { id: '6', command: 'test', title: 'New search feature', description: 'New guidance', example: 'test ABC' };
  const generated = renderMenu([...SEARCH_MENU, extra]);
  assert.ok(generated.includes(extra.title));
  assert.ok(generated.includes(extra.example));
  assert.ok(generated.includes('1, 2, 3, 6'));
});

test('menu, greetings, bare commands and numbered guidance never query inventory', async () => {
  for (const message of ['menu', 'halo', 'mulai', '1', 'menu 2', 'bantuan lokasi', 'detail', 'cari']) {
    const fetchFn = async (url, options) => {
      assert.equal(url, 'https://api.fonnte.com/send');
      assert.match(options.body.get('message'), /Ketik menu|kembali/);
      return Response.json({ status: true });
    };
    assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message }), env }, fetchFn)).status, 200);
  }
});

test('result cards neutralize formatting and show zero stock', () => {
  const text = formatInventoryReply([{ sku: '*SKU*\nInjected', nama_barang: '_Kabel_', lokasi_bulky: 'A-01', stok_akhir: 0, source: 'RPL' }]);
  assert.match(text, /\*1\. Kabel\*/);
  assert.match(text, /SKU: SKU Injected/);
  assert.match(text, /Stok: 0/);
  assert.doesNotMatch(text, /_Kabel_|\*SKU\*/);
});

test('empty later page offers usable previous-page command and help', async () => {
  const fetchFn = async (url, options) => {
    if (!url.endsWith('/send')) return Response.json([]);
    const reply = options.body.get('message');
    assert.match(reply, /Tidak ada hasil pada halaman 2/);
    assert.match(reply, /barang kabel; halaman=1/);
    assert.match(reply, /Ketik menu/);
    return Response.json({ status: true });
  };
  assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'barang kabel; halaman=2' }), env }, fetchFn)).status, 200);
});

test('global search matches different transaction business columns including numeric quantities', () => {
  const row = { sku: '00123', nama_barang: 'Kabel', qty: 12, pic: 'Andi', dokumen: 'DO-88', tanggal: '10/11/2026', from_location: 'A-01', to_location: 'B-02', source_row_number: 999 };
  const fields = ['sku', 'nama_barang', 'lokasi_bulky'];
  assert.equal(transactionMatches(row, [{ query: 'kabel andi 12 do-88', fields }]), true);
  assert.equal(transactionMatches(row, [{ query: '999', fields }]), false);
  assert.equal(transactionMatches(row, [{ query: 'b-02', fields: ['lokasi_bulky'] }]), true);
  assert.equal(transactionMatches(row, [{ query: '001', fields: ['sku'], exact: true }]), false);
});

test('inbound and outbound search display transaction quantities and preserve pagination', async () => {
  for (const command of ['masuk', 'keluar', 'barang masuk', 'barang keluar']) {
    const calls = [];
    const fetchFn = async (url, options) => {
      calls.push(url);
      if (url.endsWith('/send')) {
        const reply = options.body.get('message');
        assert.match(reply, /Jumlah transaksi: 12/);
        assert.match(reply, /Tanggal: 10\/11\/2026/);
        assert.match(reply, /Asal: A-01/);
        assert.match(reply, /PIC: Andi/);
        assert.match(reply, new RegExp(`${command}; halaman=2`));
        assert.doesNotMatch(reply, /\nStok:/);
        return Response.json({ status: true });
      }
      assert.ok(url.includes(command.includes('masuk') ? 'inventory_barang_masuk' : 'inventory_barang_keluar'));
      assert.doesNotMatch(url, /synced_at/);
      return Response.json(Array.from({ length: 4 }, () => ({ sku: '00123', nama_barang: 'Kabel', qty: 12, tanggal: '10/11/2026', from_location: 'A-01', to_location: 'B-02', pic: 'Andi' })));
    };
    assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: command }), env }, fetchFn)).status, 200);
    assert.equal(calls.length, 2);
  }
});

test('transaction parser prevents contradictory sources and stock filters', () => {
  assert.equal(parseAdvancedCommand('masuk kabel; halaman=2').source, 'Barang Masuk');
  assert.equal(parseAdvancedCommand('keluar').filters.length, 0);
  assert.throws(() => parseAdvancedCommand('masuk kabel; sumber=BULKY'), /tidak sesuai/);
  assert.throws(() => parseAdvancedCommand('keluar kabel; stok=ada'), /hanya untuk/);
});

test('transaction scan reports incomplete results rather than claiming all history was searched', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return Response.json(Array.from({ length: calls === 6 ? 1 : 1000 }, () => ({ sku: 'OTHER' }))); };
  const result = await searchTransactions({ url: 'https://test.supabase.co', key: 'test' }, 'inventory_barang_masuk', 'Barang Masuk', { page: 1, filters: [{ query: 'missing', fields: ['sku'] }] }, fetchFn);
  assert.equal(calls, 6);
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.rows, []);
});

test('global transaction filters never query unsupported stock columns', async () => {
  let reads = 0;
  const fetchFn = async (url, options) => {
    if (url.endsWith('/send')) {
      assert.match(options.body.get('message'), /Jumlah transaksi: 1/);
      assert.match(options.body.get('message'), /Sumber: Barang Masuk/);
      return Response.json({ status: true });
    }
    reads++;
    assert.match(url, /inventory_barang_/);
    return Response.json([{ sku: '00123', nama_barang: 'Kabel', qty: 1, pic: 'Andi' }, { sku: '002', qty: 1, pic: 'Budi' }]);
  };
  assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'cari pic=andi; jumlah=1' }), env }, fetchFn)).status, 200);
  assert.equal(reads, 2);
});

test('global result cards show all fifteen rows, without silently dropping outbound matches', async () => {
  const fetchFn = async (url, options) => {
    if (url.endsWith('/send')) {
      const reply = options.body.get('message');
      assert.match(reply, /15 baris ditampilkan/);
      assert.match(reply, /Sumber: Barang Keluar/);
      assert.match(reply, /\*15\./);
      return Response.json({ status: true });
    }
    return Response.json(Array.from({ length: 3 }, () => ({ sku: 'ABC', nama_barang: 'Kabel', stok_akhir: 2, qty: 1 })));
  };
  assert.equal((await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'kabel' }), env }, fetchFn)).status, 200);
});
