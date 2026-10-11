import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFonnteWebhook } from '../supabase/functions/whatsapp-fonnte/handler.js';
import { APP_CONFIG } from '../assets/js/config.js';
import { PIC_BY_ROLE, resolvePic } from '../assets/js/pic-config.js';
import { normalizePhone, findPhoneProfile } from '../supabase/functions/whatsapp-fonnte/profiles.js';
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const privateKey = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
const item = { sku: '00123', nama_barang: 'Merlyn Green Gold', lokasi_bulky: 'A20-1', stok_akhir: 12, source_row_number: 2 };
const user = { id: 'user-id', full_name: 'Andi', username: 'andi', email: 'andi@test.invalid', role: 'PIC Inventory', phone_number: '6281234567890' };
function fixture({ profiles = [{ ...user }], allowlisted = true, claimFail = false, liveStock = 12, headerFail = false, writeFail = false, many = false, profileReadFail = false, auditFail = false, occupiedBeforeWrite = false, targetRow = [], sheetRows } = {}) {
 const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-role', FONNTE_TOKEN: 'test', FONNTE_WEBHOOK_SECRET: 'secret', WHATSAPP_ALLOWED_NUMBERS: allowlisted ? '6281234567890' : '', GOOGLE_CLIENT_EMAIL: 'test@example.com', GOOGLE_PRIVATE_KEY: privateKey, SHEET_ID_2026: 'transactions' };
 let session; const replies = [], writes = [], queries = [], audits = [];
 const fetchFn = async (url, options = {}) => {
  const q = new URL(url).searchParams;
  if (url.endsWith('/send')) { replies.push(options.body.get('message')); return Response.json({ status: true }); }
  if (url.includes('/activity_logs')) { audits.push(JSON.parse(options.body)); return new Response(null, { status: auditFail ? 500 : 201 }); }
  if (url.includes('/users?')) {
   queries.push(url); if (profileReadFail) return Response.json({}, { status: 400 }); return Response.json(profiles);
  }
  if (url.includes('whatsapp_search_sessions')) {
   if (options.method === 'POST') { session = JSON.parse(options.body).search; return new Response(null, { status: 201 }); }
   if (options.method === 'PATCH') {
    if (claimFail || session.phase !== 'confirm' || q.get('search->>nonce') !== `eq.${session.nonce}`) return Response.json([]);
    session = JSON.parse(options.body).search; return Response.json([{ search: session }]);
   }
   return Response.json(session ? [{ search: session }] : []);
  }
  if (url.includes('inventory_kartu_stok')) {
   queries.push(url);
   if (q.has('lokasi_bulky')) return Response.json(q.get('lokasi_bulky') === 'eq.A20-1' ? [{ stok_akhir: 12 }] : []);
   if (many && q.get('offset') === '0') return Response.json(Array.from({ length: 11 }, (_, i) => ({ ...item, sku: `SKU${i}` })));
   return Response.json([item]);
  }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test' });
  if (url.includes('sheets.googleapis.com')) {
   if (options.method === 'PUT') { writes.push({ url, body: JSON.parse(options.body) }); return Response.json({}, { status: writeFail ? 500 : 200 }); }
   const decoded = decodeURIComponent(url);
   if (decoded.includes('Kartu Stock')) return Response.json({ values: [['LOKASI BULKY','SKU','NAMA BARANG','STOK AKHIR'], ['A20-1','00123','Merlyn Green Gold',String(liveStock)]] });
   if (/!A\d+:I\d+/.test(decoded)) return Response.json({ values: occupiedBeforeWrite ? [['existing']] : [targetRow] });
   const header = headerFail ? ['wrong'] : ['TANGGAL','FROM','TO','SKU','NAMA BARANG','QTY','STATUS','PIC','KETERANGAN'];
   return Response.json({ values: [header, ...(sheetRows || [['date','old','old','OLD','Old',1,'Barang Masuk','ABI','RECEIPT'], [], ['date','later','later','LATER','Later',1,'Barang Masuk','ABI','RECEIPT']])] });
  }
  throw new Error('Unexpected URL: ' + url);
 };
 const request = message => new Request('https://test/functions/v1/whatsapp-fonnte?secret=secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: '6281234567890', message }) });
 const send = async message => { assert.equal((await handleFonnteWebhook({ request: request(message), env }, fetchFn)).status, 200); return replies.at(-1); };
 return { send, env, profiles, replies, writes, queries, audits, fetchFn, request, get session() { return session; } };
}
async function preview(f, direction = 'out', location = 'sama', command = `stock ${direction}`) {
 assert.match(await f.send(`${command} merlyn a20-1`), /Pilih barang/);
 assert.match(await f.send('1'), direction === 'in' ? /From/ : /Lokasi/);
 if (direction === 'in') assert.match(await f.send('iwt e-com'), /To/);
 assert.match(await f.send(location), /Qty (Inbound|Outbount)/);
 assert.match(await f.send('5'), /Tinjau (Inbound|Outbount)/);
 assert.equal(f.session.phase, 'confirm'); assert.equal(f.writes.length, 0);
}
test('inbound asks From and To; both flows use configured PIC and WMS sheet statuses', async () => {
 for (const direction of ['in','out']) {
  const f = fixture(); await preview(f, direction, direction === 'in' ? 'b01' : 'sama');
  assert.match(await f.send('simpan'), /tersimpan/); assert.equal(f.writes.length, 1);
  const values = f.writes[0].body.values[0];
  assert.deepEqual(values.slice(1,8), direction === 'in' ? ['IWT E-COM', 'B01','00123','Merlyn Green Gold',5,'Barang Masuk','ABI'] : ['A20-1','','00123','Merlyn Green Gold',5,'Barang Keluar','ABI']);
  assert.match(values[0], /^\d{1,2}\/\d{1,2}\/\d{4}$/); assert.equal(values[8], direction === 'in' ? 'RECEIPT' : 'STOCK OUT WHATSAPP');
  assert.equal(f.audits[0].user_name, 'andi@test.invalid'); assert.equal(f.audits[0].user_id, 'user-id');
  assert.match(decodeURIComponent(f.writes[0].url), /!A3:I3/); assert.doesNotMatch(f.writes[0].url, /:append/);
  assert.equal(new URL(f.writes[0].url).searchParams.get('valueInputOption'), 'RAW');
  assert.match(decodeURIComponent(f.writes[0].url), direction === 'in' ? /Barang Masuk/ : /Barang KeIuar/);
  assert.match(await f.send('simpan'), /sudah diproses/); assert.equal(f.writes.length, 1);
  const inventoryQuery = f.queries.find(url => url.includes('inventory_kartu_stok'));
  assert.equal(new URL(inventoryQuery).searchParams.has('stok_akhir'), direction === 'out');
 }
});
test('profile-based authorization permits a registered user without static allowlists', async () => {
 const f = fixture({ allowlisted: false }); await preview(f, 'in'); assert.match(await f.send('simpan'), /tersimpan/);
 const q = new URL(f.queries.find(url => url.includes('/users?'))).searchParams;
 assert.equal(q.get('phone_number'), 'in.("6281234567890","+6281234567890","081234567890")');
});
test('missing, duplicate, and read-only profiles cannot start transactions', async () => {
 for (const [profiles, pattern] of [[[], /belum terdaftar/], [[user,user], /lebih dari satu/], [[{ ...user, role: 'Warga KST' }], /read-only/]]) {
  const f = fixture({ profiles }); assert.match(await f.send('stock in'), pattern); assert.equal(f.writes.length, 0);
 }
 const f = fixture({ profileReadFail: true }); assert.match(await f.send('stock out'), /Profil user belum dapat dibaca/);
});
test('profile is revalidated before saving; revoked roles or changed user identity cannot commit', async () => {
 for (const mutation of [profile => profile.role = 'Warga KST', profile => profile.id = 'other-id']) {
  const f = fixture(); await preview(f); mutation(f.profiles[0]); assert.match(await f.send('simpan'), /read-only|Profil nomor WhatsApp sudah berubah/); assert.equal(f.writes.length, 0);
 }
 const f = fixture(); await preview(f); f.profiles.splice(0); assert.match(await f.send('simpan'), /belum terdaftar/); assert.equal(f.writes.length, 0);
});
test('PIC comes from shared role config and role changes require a fresh review', async () => {
 const f = fixture({ profiles: [{ ...user, role: 'PIC Inbound' }] }); await preview(f, 'in');
 assert.equal(f.session.pic, 'ENGGAL'); f.profiles[0].role = 'PIC Outbound';
 assert.match(await f.send('simpan'), /PIC konfigurasi berubah/); assert.equal(f.writes.length, 0);
 await f.send('simpan'); assert.equal(f.writes[0].body.values[0][7], 'EPRIL');
});
test('profile name changes do not override configured PIC', async () => {
 const f = fixture(); await preview(f); f.profiles[0].full_name = 'Budi'; await f.send('simpan');
 assert.equal(f.writes[0].body.values[0][7], 'ABI'); assert.equal(f.audits[0].metadata.actor_name, 'Budi');
});
test('stock out rejects nonexistent locations and invalid quantities', async () => {
 const f = fixture(); await f.send('stock out merlyn'); await f.send('1');
 assert.match(await f.send('b01'), /tidak memiliki satu baris stok positif/); await f.send('sama');
 for (const input of ['0','-1','13','Infinity','1e2']) assert.match(await f.send(input), /Qty harus/);
 assert.equal(f.session.phase, 'quantity'); assert.equal(f.writes.length, 0);
});
test('fresh source stock and source headers are checked before every mutation', async () => {
 for (const options of [{ liveStock: 3 }, { liveStock: 20 }, { headerFail: true }]) {
  const f = fixture(options); await preview(f); assert.match(await f.send('simpan'), /tidak disimpan/); assert.equal(f.writes.length, 0);
 }
});
test('cancel, menu, and restart discard drafts without storing a transaction', async () => {
 for (const action of ['batal','menu','ubah']) {
  const f = fixture(); await preview(f); assert.match(await f.send(action), action === 'batal' ? /dibatalkan/ : action === 'menu' ? /Menu WMS/ : /Kirim SKU/); assert.equal(f.writes.length, 0);
 }
});
test('pagination remains available and only current page row numbers may be selected', async () => {
 const f = fixture({ many: true }); assert.match(await f.send('stock in merlyn'), /lanjut/);
 assert.match(await f.send('99'), /tidak tersedia/); assert.match(await f.send('lanjut'), /Halaman 2/);
 assert.match(await f.send('lanjut'), /halaman terakhir/); assert.match(await f.send('sebelumnya'), /Halaman 1/);
});
test('failed confirmation claim does not write and uncertain writes are not retried', async () => {
 const blocked = fixture({ claimFail: true }); await preview(blocked); assert.match(await blocked.send('simpan'), /sudah diproses atau kedaluwarsa/); assert.equal(blocked.writes.length, 0);
 const f = fixture({ writeFail: true }); await preview(f); assert.match(await f.send('simpan'), /belum terkonfirmasi/); await f.send('simpan'); assert.equal(f.writes.length, 1);
});
test('unregistered phones are ignored and database profile failures fail closed', async () => {
 const missing = fixture({ profiles: [], allowlisted: false }); const response = await handleFonnteWebhook({ request: missing.request('menu'), env: missing.env }, missing.fetchFn);
 assert.deepEqual(await response.json(), { success: true, ignored: true }); assert.equal(missing.replies.length, 0);
 const broken = fixture({ allowlisted: false, profileReadFail: true }); assert.equal((await handleFonnteWebhook({ request: broken.request('menu'), env: broken.env }, broken.fetchFn)).status, 503); assert.equal(broken.replies.length, 0);
});
test('phone formats preserve Indonesian identity and reject mismatched returned profiles', async () => {
 assert.equal(normalizePhone('0812-3456-7890'), '6281234567890'); assert.equal(normalizePhone('+62 812 3456 7890'), '6281234567890');
 const config = { url: 'https://test.supabase.co', key: 'test' };
 await assert.rejects(findPhoneProfile(config, '6281234567890', async () => Response.json([{ ...user, phone_number: '62800000000' }])), /tidak cocok/);
});

test('inbound, outbount and outbound prompts select the correct stock flow', async () => {
 for (const [command, direction] of [['inbound', 'in'], ['outbount', 'out'], ['outbound', 'out']]) {
  const f = fixture(); await preview(f, direction, 'sama', command);
  assert.equal(f.session.direction, direction); await f.send('simpan');
  assert.equal(f.writes[0].body.values[0][6], direction === 'in' ? 'Barang Masuk' : 'Barang Keluar');
 }
});

test('first empty row selection skips rows with SKU and leaves auxiliary columns untouched', async () => {
 const f = fixture({ sheetRows: [['','','','PARTIAL'], ['','','','','','','','','','=IF(A3="","",1)'], ['date','','','LATE']] });
 await preview(f, 'in'); await f.send('simpan'); assert.match(decodeURIComponent(f.writes[0].url), /!A3:I3/);
 assert.equal(f.writes[0].body.values[0][8], 'RECEIPT');
});
test('a row filled by another writer is rejected before mutation', async () => {
 const f = fixture({ occupiedBeforeWrite: true }); await preview(f, 'in');
 assert.match(await f.send('simpan'), /Baris tujuan sudah diisi/); assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
});
test('audit failure does not retry a transaction that already succeeded', async () => {
 const f = fixture({ auditFail: true }); await preview(f, 'in');
 assert.match(await f.send('simpan'), /History WMS belum tercatat/); await f.send('simpan'); assert.equal(f.writes.length, 1);
});

test('bot and WMS share PIC config for inbound, outbound, inventory, picker and developer roles', () => {
 assert.equal(APP_CONFIG.PIC_BY_ROLE, PIC_BY_ROLE);
 for (const [role, expected] of [['PIC Inbound', 'ENGGAL'], ['PIC Outbound', 'EPRIL'], ['PIC Inventory', 'ABI'], ['PIC Picker', 'WINDI'], ['Developer', 'ABI']]) assert.equal(resolvePic(role), expected);
});

test('inbound uses the earliest template row even when it contains defaults, a document chip or side-column data', async () => {
 const template = ['', 'IWT E-COM', 'MASIH DI INBOUND', '', '', '', 'Barang Masuk', 'ENGGAL', 'RECEIPT', 'metadata', '', '', '', '', 'document chip'];
 const f = fixture({ sheetRows: [template, ['date', '', '', 'LATER']], targetRow: template.slice(0, 9) });
 await preview(f, 'in'); await f.send('simpan');
 assert.equal(f.writes.length, 1); assert.match(decodeURIComponent(f.writes[0].url), /!A2:I2/);
 assert.equal(f.writes[0].body.values[0].length, 9); assert.equal(f.writes[0].body.values[0][3], '00123');
});
test('transaction-row selection and recheck read displayed values rather than blank-returning formulas', async () => {
 for (const direction of ['in', 'out']) {
  const f = fixture({ sheetRows: [[], ['date', '', '', 'LATER']] });
  const reads = [];
  const observed = async (url, init) => { if (url.includes('sheets.googleapis.com') && !init?.method && decodeURIComponent(url).includes(direction === 'in' ? 'Barang Masuk' : 'Barang KeIuar')) reads.push(url); return f.fetchFn(url, init); };
  await preview(f, direction);
  assert.equal((await handleFonnteWebhook({ request: f.request('simpan'), env: f.env }, observed)).status, 200);
  assert.equal(reads.length, 2); assert.ok(reads.every(url => new URL(url).searchParams.get('valueRenderOption') === 'FORMATTED_VALUE'));
  assert.match(decodeURIComponent(f.writes[0].url), /!A2:I2/);
 }
});
test('a SKU added to a template row before saving aborts without overwriting it', async () => {
 const f = fixture({ sheetRows: [[]], targetRow: ['', '', '', 'ANOTHER-SKU'] });
 await preview(f, 'in'); assert.match(await f.send('simpan'), /Baris tujuan sudah diisi/); assert.equal(f.writes.length, 0);
});
