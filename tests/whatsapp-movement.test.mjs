import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFonnteWebhook } from '../supabase/functions/whatsapp-fonnte/handler.js';
import { movementDates } from '../supabase/functions/whatsapp-fonnte/sheet-movement.js';
const envBase = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-role', FONNTE_TOKEN: 'test', FONNTE_WEBHOOK_SECRET: 'secret', WHATSAPP_ALLOWED_NUMBERS: '6281234567890', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh', SHEET_ID_2026: 'transactions', SHEET_ID_INVENTORY: 'history' };
const row = { sku: '00123', nama_barang: 'Merlyn Green Gold', lokasi_bulky: 'A20-1', stok_akhir: 12 };
function fixture({ allowed = true, liveStock = 12, partial = false, primaryFail = false, claimFail = false, invalidHeader = false, noConfig = false, readFails = 0, liveName = row.nama_barang, locationRows, occupied = false, auditFail = false } = {}) {
 const env = { ...envBase, SHEET_ID_INVENTORY: noConfig ? '' : 'history' };
 const profile = { id: 'user-id', full_name: 'Andi', email: 'andi@test.invalid', role: allowed ? 'PIC Inventory' : 'Viewer', phone_number: '6281234567890' };
 let session; const writes = [], replies = [], queries = [], audits = [];
 const locations = locationRows || [{ lokasi_bulky: 'A20-1', stok_akhir: 12 }, { lokasi_bulky: 'B01', stok_akhir: 20 }];
 const fetchFn = async (url, options = {}) => {
  const q = new URL(url).searchParams;
  if (url.endsWith('/send')) { replies.push(options.body.get('message')); return Response.json({ status: true }); }
  if (url.includes('/users?')) return Response.json([profile]);
  if (url.includes('/activity_logs')) { audits.push(JSON.parse(options.body)); return new Response(null, { status: auditFail ? 500 : 201 }); }
  if (url.includes('whatsapp_search_sessions')) {
   if (options.method === 'POST') { session = JSON.parse(options.body).search; return new Response(null, { status: 201 }); }
   if (options.method === 'PATCH') {
    if (claimFail || q.get('search->>phase') !== `eq.${session.phase}` || q.get('search->>nonce') !== `eq.${session.nonce}`) return Response.json([]);
    session = JSON.parse(options.body).search; return Response.json([{ search: session }]);
   }
   return Response.json(session ? [{ search: session }] : []);
  }
  if (url.includes('inventory_kartu_stok')) {
   queries.push(url); const values = q.has('sku') ? locations : [row, { ...row, lokasi_bulky: 'B01' }];
   return Response.json(values.slice(Number(q.get('offset') || 0), Number(q.get('offset') || 0) + Number(q.get('limit'))));
  }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test' });
  if (url.includes('sheets.googleapis.com')) {
   if (options.method === 'POST' || options.method === 'PUT') { writes.push({ url, method: options.method, body: JSON.parse(options.body) }); return Response.json({}, { status: (partial && url.includes('/history/')) || (primaryFail && options.method === 'PUT') ? 500 : 200 }); }
   const decoded = decodeURIComponent(url);
   if (decoded.includes('Kartu Stock')) return Response.json({ values: [['Report'], [], ['LOKASI BULKY','SKU','NAMA BARANG','STOK AKHIR'], ['A20-1','00123',liveName,liveStock], ['B01','00123',row.nama_barang,20]] });
   if (decoded.includes('Barang Masuk')) {
    if (readFails-- > 0) throw new TypeError('Network unavailable');
    if (/!A(\d+):I\1(?:\?|$)/.test(decoded)) return Response.json({ values: occupied ? [['date','','','OTHER']] : [] });
    assert.match(decoded, /!A1:I500/);
    return Response.json({ values: [['TANGGAL','FROM','TO','SKU','NAMA BARANG','QTY','STATUS','PIC','KETERANGAN'], ['date','','','OLD'], ['', 'template'], ['date','','','LATE']] });
   }
   return Response.json({ values: [['History'], [], invalidHeader ? ['wrong'] : ['Tanggal','From','To','SKU','Nama','Awal','Aktual']] });
  }
  throw new Error('Unexpected request');
 };
 const send = async message => {
  const request = new Request('https://test/functions/v1/whatsapp-fonnte?secret=secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: '6281234567890', message }) });
  assert.equal((await handleFonnteWebhook({ request, env }, fetchFn)).status, 200); return replies.at(-1);
 };
 return { send, writes, queries, audits, profile, get session() { return session; } };
}
async function preview(f, { all = false, suggested = false } = {}) {
 const items = await f.send('movement merlyn a20-1'); assert.match(items, /Pilih barang/); assert.equal((items.match(/SKU: 00123/g) || []).length, 1);
 assert.match(await f.send('1'), /Pilih From/); assert.match(await f.send('1'), /Pilih To/);
 await f.send(suggested ? 'y' : 'b01');
 assert.match(await f.send(all ? 'y' : '5'), /Tinjau Movement/); assert.equal(f.writes.length, 0);
}
test('movement uses configured PIC, first available transaction row and app history fields after y confirmation', async () => {
 const f = fixture(); await preview(f);
 assert.match(await f.send('simpan'), /Balas y/); assert.equal(f.writes.length, 0);
 const reply = await f.send('y'); assert.match(reply, /Movement tersimpan/); assert.doesNotMatch(reply, /Referensi|Sinkron/);
 assert.equal(f.writes.length, 2); assert.equal(f.writes[0].method, 'PUT'); assert.match(decodeURIComponent(f.writes[0].url), /!A3:I3/);
 assert.deepEqual(f.writes[0].body.values[0].slice(1), ['A20-1','B01','00123','Merlyn Green Gold',5,'Movement','ABI','INTERNAL STOCK TRANSFER']);
 assert.deepEqual(f.writes[1].body.values[0].slice(1), ['A20-1','B01','00123','Merlyn Green Gold',12,5]);
 assert.equal(new URL(f.writes[0].url).searchParams.get('valueInputOption'), 'RAW');
 assert.equal(f.audits[0].action, 'CREATE_MOVEMENT'); assert.equal(f.audits[0].user_name, 'andi@test.invalid');
 assert.match(await f.send('y'), /sudah diproses/); assert.equal(f.writes.length, 2);
});
test('movement suggests the destination with most stock and supports y for full source quantity', async () => {
 const f = fixture(); await preview(f, { all: true, suggested: true }); assert.equal(f.session.to, 'B01'); assert.equal(f.session.qty, 12);
 assert.match(await f.send('y'), /Sisa stok asal: 0/);
});
test('movement rejects same source/destination and invalid quantities', async () => {
 const f = fixture(); await f.send('movement merlyn'); await f.send('1');
 assert.match(await f.send('99'), /tidak tersedia/); await f.send('1');
 assert.match(await f.send('a20-1'), /berbeda/); await f.send('b01');
 for (const value of ['0','-1','13','NaN','1e2']) assert.match(await f.send(value), /lebih dari 0/);
 assert.equal(f.session.phase, 'quantity'); assert.equal(f.writes.length, 0);
});
test('changed source stock requires re-confirmation; insufficient stock and invalid headers prevent writes', async () => {
 for (const options of [{ liveStock: 4 }, { invalidHeader: true }, { occupied: true }]) {
  const f = fixture(options); await preview(f); assert.match(await f.send('y'), /tidak disimpan|belum disimpan/); assert.equal(f.writes.length, 0);
 }
 const changed = fixture({ liveStock: 20 }); await preview(changed); assert.match(await changed.send('y'), /ringkasan terbaru/); assert.equal(changed.writes.length, 0);
 await changed.send('y'); assert.equal(changed.writes[1].body.values[0][5], 20);
});
test('cancel and menu discard draft, while read-only roles and missing configuration prevent start', async () => {
 for (const action of ['batal','menu']) { const f = fixture(); await preview(f); assert.match(await f.send(action), action === 'batal' ? /dibatalkan/ : /Menu WMS/); assert.equal(f.writes.length, 0); }
 assert.match(await fixture({ allowed: false }).send('movement'), /read-only/);
 assert.match(await fixture({ noConfig: true }).send('movement'), /SHEET_ID_INVENTORY/);
});
test('failed claim and primary/history uncertainty never allow duplicate writes', async () => {
 const denied = fixture({ claimFail: true }); await preview(denied); assert.match(await denied.send('y'), /kedaluwarsa/); assert.equal(denied.writes.length, 0);
 const partial = fixture({ partial: true }); await preview(partial); assert.match(await partial.send('y'), /Barang Masuk.*sudah tersimpan.*riwayat Movement belum terkonfirmasi/);
 assert.match(await partial.send('ulang'), /sudah diproses/); assert.equal(partial.writes.length, 2); assert.equal(partial.audits.length, 0);
 const primary = fixture({ primaryFail: true }); await preview(primary); assert.match(await primary.send('y'), /Status penulisan belum terkonfirmasi/); await primary.send('ulang'); assert.equal(primary.writes.length, 1);
});
test('read failures retain the complete movement draft for ulang', async () => {
 const f = fixture({ readFails: 1 }); await preview(f); assert.match(await f.send('y'), /Balas ulang/); assert.equal(f.session.phase, 'retry'); assert.equal(f.writes.length, 0);
 assert.match(await f.send('ulang'), /Movement tersimpan/); assert.equal(f.writes.length, 2); assert.equal(f.writes[0].body.values[0][5], 5);
});
test('role revocation blocks save, changed PIC and changed names request a new review', async () => {
 const f = fixture(); await preview(f); f.profile.role = 'Viewer'; assert.match(await f.send('y'), /read-only/); assert.equal(f.writes.length, 0);
 const changed = fixture(); await preview(changed); changed.profile.role = 'PIC Inbound'; assert.match(await changed.send('y'), /PIC berubah/); assert.equal(changed.writes.length, 0); await changed.send('y'); assert.equal(changed.writes[0].body.values[0][7], 'ENGGAL');
 const name = fixture({ liveName: 'MERLYN NEW NAME' }); await preview(name); assert.match(await name.send('y'), /ringkasan terbaru/); assert.equal(name.writes.length, 0); await name.send('y'); assert.equal(name.writes[0].body.values[0][4], 'MERLYN NEW NAME');
});
test('audit failure reports a saved movement without offering ulang', async () => {
 const f = fixture({ auditFail: true }); await preview(f); assert.match(await f.send('y'), /Movement sudah tersimpan/); await f.send('ulang'); assert.equal(f.writes.length, 2);
});
test('movement dates use Jakarta business day across UTC midnight boundary', () => {
 assert.deepEqual(movementDates(new Date('2026-10-11T18:00:00Z')), { date: '2026-10-12', sheetDate: '10/12/2026' });
});

test('movement source/destination location pages retain choices and prefer matching location patterns', async () => {
 const f = fixture({ locationRows: Array.from({ length: 12 }, (_, index) => ({ lokasi_bulky: `A${String(index).padStart(2, '0')}`, stok_akhir: 12 })) });
 await f.send('movement merlyn'); await f.send('1');
 assert.match(await f.send('lanjut'), /Halaman 2/); assert.match(await f.send('3'), /tidak tersedia/);
 await f.send('2'); assert.equal(f.session.row.lokasi_bulky, 'A11'); assert.equal(f.session.phase, 'destination');
 assert.match(await f.send('lanjut'), /Halaman 2/); await f.send('1'); assert.equal(f.session.to, 'A10');
 const patterned = fixture({ locationRows: [{ lokasi_bulky: 'A20-1', stok_akhir: 12 }, { lokasi_bulky: 'A21-1', stok_akhir: 10 }, { lokasi_bulky: 'B01', stok_akhir: 200 }] });
 await patterned.send('movement merlyn'); await patterned.send('1');
 assert.match(await patterned.send('1'), /saran To: A21-1/); await patterned.send('y'); assert.equal(patterned.session.to, 'A21-1');
});
test('movement accepts a new destination when no other existing location is available', async () => {
 const f = fixture({ locationRows: [{ lokasi_bulky: 'A20-1', stok_akhir: 12 }] });
 await f.send('movement merlyn'); await f.send('1'); assert.match(await f.send('1'), /Ketik lokasi tujuan baru/);
 assert.match(await f.send('y'), /Belum ada saran/); await f.send('c30-1'); await f.send('5');
 assert.match(await f.send('y'), /Movement tersimpan/); assert.equal(f.writes[0].body.values[0][2], 'C30-1');
});
