import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFonnteWebhook } from '../supabase/functions/whatsapp-fonnte/handler.js';
import { movementDates } from '../supabase/functions/whatsapp-fonnte/sheet-movement.js';
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const privateKey = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
const row = { sku: '00123', nama_barang: 'Merlyn Green Gold', lokasi_bulky: 'A20-1', stok_akhir: 12, source_row_number: 2 };
function fixture({ allowed = true, liveStock = 12, partial = false, claimFail = false, invalidHeader = false, noConfig = false } = {}) {
 const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-role', FONNTE_TOKEN: 'test', FONNTE_WEBHOOK_SECRET: 'secret', WHATSAPP_ALLOWED_NUMBERS: '6281234567890', WHATSAPP_EDITOR_NUMBERS: allowed ? '6281234567890' : '', GOOGLE_CLIENT_EMAIL: 'test@example.com', GOOGLE_PRIVATE_KEY: privateKey, SHEET_ID_2026: 'transactions', SHEET_ID_INVENTORY: noConfig ? '' : 'history' };
 let session; const writes = [], replies = [], queries = [];
 const fetchFn = async (url, options = {}) => {
  const q = new URL(url).searchParams;
  if (url.endsWith('/send')) { replies.push(options.body.get('message')); return Response.json({ status: true }); }
  if (url.includes('whatsapp_search_sessions')) {
   if (options.method === 'POST') { session = JSON.parse(options.body).search; return new Response(null, { status: 201 }); }
   if (options.method === 'PATCH') {
    if (claimFail || session.phase !== 'confirm' || q.get('search->>nonce') !== `eq.${session.nonce}`) return Response.json([]);
    session = JSON.parse(options.body).search; return Response.json([{ search: session }]);
   }
   return Response.json(session ? [{ search: session }] : []);
  }
  if (url.includes('inventory_kartu_stok')) { queries.push(url); return Response.json([row]); }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test' });
  if (url.includes('sheets.googleapis.com')) {
   if (options.method === 'POST') { writes.push({ url, body: JSON.parse(options.body) }); return Response.json({}, { status: partial && url.includes('/history/') ? 500 : 200 }); }
   const decoded = decodeURIComponent(url);
   if (decoded.includes('Kartu Stock')) return Response.json({ values: [['LOKASI BULKY','SKU','NAMA BARANG','STOK AKHIR'], ['A20-1','00123','Merlyn Green Gold',String(liveStock)]] });
   if (decoded.includes('Barang Masuk')) return Response.json({ values: [['TANGGAL','FROM','TO','SKU','NAMA BARANG','QTY','STATUS','PIC','KETERANGAN']] });
   return Response.json({ values: [invalidHeader ? ['wrong'] : ['Tanggal','From','To','SKU','Nama','Stok Lokasi Awal','Stok Aktual']] });
  }
  throw new Error('Unexpected request: ' + url);
 };
 const send = async message => {
  const request = new Request('https://test/functions/v1/whatsapp-fonnte?secret=secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: '6281234567890', message }) });
  assert.equal((await handleFonnteWebhook({ request, env }, fetchFn)).status, 200);
  return replies.at(-1);
 };
 return { send, writes, queries, get session() { return session; } };
}
async function preview(f) {
 assert.match(await f.send('movement merlyn a20-1'), /Pilih barang/);
 assert.match(await f.send('1'), /Lokasi tujuan/);
 await f.send('b01'); await f.send('5');
 assert.match(await f.send('Andi'), /Tinjau movement/);
 assert.equal(f.writes.length, 0);
}
test('guided movement follows WMS source entries after confirmation and guards duplicate save', async () => {
 const f = fixture(); await preview(f);
 assert.match(await f.send('simpan'), /Movement tersimpan/);
 assert.equal(f.writes.length, 2);
 const inbound = f.writes[0].body.values[0], history = f.writes[1].body.values[0];
 assert.deepEqual(inbound.slice(1, 8), ['A20-1','B01','00123','Merlyn Green Gold',5,'Movement','Andi']);
 assert.match(inbound[8], /^INTERNAL STOCK TRANSFER \| WA:/);
 assert.deepEqual(history.slice(1), ['A20-1','B01','00123','Merlyn Green Gold',12,5]);
 assert.equal(new URL(f.writes[0].url).searchParams.get('valueInputOption'), 'RAW');
 assert.match(await f.send('simpan'), /sudah diproses/); assert.equal(f.writes.length, 2);
 assert.match(decodeURIComponent(f.queries[0]), /stok_akhir=gt.0.*and=\(or\(.*merlyn.*or\(.*a20-1/);
});
test('movement validates source destination and quantities before review', async () => {
 const f = fixture(); await f.send('movement'); await f.send('merlyn');
 assert.match(await f.send('99'), /tidak tersedia/); await f.send('1');
 assert.match(await f.send('a20-1'), /berbeda/); await f.send('b01');
 for (const value of ['0','-1','13','NaN']) assert.match(await f.send(value), /lebih dari 0/);
 assert.equal(f.session.phase, 'quantity'); assert.equal(f.writes.length, 0);
});
test('changed source stock and invalid headers prevent every write', async () => {
 for (const options of [{ liveStock: 4 }, { liveStock: 20 }, { invalidHeader: true }]) {
  const f = fixture(options); await preview(f); assert.match(await f.send('simpan'), /tidak disimpan/); assert.equal(f.writes.length, 0);
 }
});
test('cancel and menu discard movement draft without writing', async () => {
 for (const action of ['batal', 'menu']) { const f = fixture(); await preview(f); assert.match(await f.send(action), action === 'batal' ? /dibatalkan/ : /Menu WMS/); assert.equal(f.writes.length, 0); assert.equal(f.session.kind, undefined); }
});
test('editor permissions and missing movement configuration prevent start', async () => {
 assert.match(await fixture({ allowed: false }).send('movement merlyn'), /belum memiliki izin/);
 assert.match(await fixture({ noConfig: true }).send('movement'), /SHEET_ID_INVENTORY/);
});
test('failed claim prevents mutation and partial writes are reported without retry', async () => {
 const denied = fixture({ claimFail: true }); await preview(denied); assert.match(await denied.send('simpan'), /sudah diproses atau kedaluwarsa/); assert.equal(denied.writes.length, 0);
 const f = fixture({ partial: true }); await preview(f); assert.match(await f.send('simpan'), /Barang Masuk tersimpan; riwayat Movement belum terkonfirmasi/); await f.send('simpan'); assert.equal(f.writes.length, 2);
});
test('movement dates use Jakarta business day across UTC midnight boundary', () => {
 assert.deepEqual(movementDates(new Date('2026-10-11T18:00:00Z')), { date: '2026-10-12', sheetDate: '10/12/2026' });
});
