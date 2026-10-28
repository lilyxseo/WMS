import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFonnteWebhook as actualWebhook, parseInventoryMessage, formatInventoryReply } from '../supabase/functions/whatsapp-fonnte/handler.js';

const handleFonnteWebhook=(context,fetchFn)=>actualWebhook(context,(url,options)=>url.endsWith('/rpc/notification_allowed_numbers')?Promise.resolve(Response.json(['6281234567890'])):fetchFn(url,options));
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
    assert.match(url, /or=\(sku\.ilike/);
    assert.doesNotMatch(url, /nama_barang\.ilike/);
    return Response.json([{ sku: '00123', nama_barang: 'Kabel', lokasi_bulky: 'A-01', stok_akhir: 7 }]);
  };
  const response = await handleFonnteWebhook({ request: request({ sender: '6281234567890', message: 'sku 00123' }), env }, fetchFn);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 4);
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
    assert.match(options.body.get('message'), /sku ABC123/);
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
