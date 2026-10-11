import test from 'node:test';
import assert from 'node:assert/strict';
import { kartuStokCandidates, readKartuStock } from '../supabase/functions/whatsapp-fonnte/kartu-stok-source.js';
import { GoogleAccessError } from '../supabase/functions/whatsapp-fonnte/google-errors.js';
import { commitStock } from '../supabase/functions/whatsapp-fonnte/sheet-stock.js';
import { handleGoogleCheck } from '../supabase/functions/whatsapp-fonnte/google-check.js';
const env = { SHEET_ID_2026: 'transactions', SHEET_ID_INVENTORY: 'inventory', GOOGLE_OAUTH_CLIENT_ID: 'test-id', GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret', GOOGLE_OAUTH_REFRESH_TOKEN: 'test-refresh' };

test('inventory stock source is independent of the transaction destination with a legacy fallback', async () => {
 const seen = [];
 const rows = await readKartuStock(env, async (id, range) => { seen.push(id); assert.equal(range, "'Kartu Stock'!A:Z"); return [['stock']]; });
 assert.deepEqual(seen, ['inventory']); assert.deepEqual(rows, [['stock']]);
 const fallback = [];
 await readKartuStock(env, async id => { fallback.push(id); if (id === 'inventory') throw new GoogleAccessError('SHEET_TAB_MISSING', 'Missing'); return []; });
 assert.deepEqual(fallback, ['inventory','transactions']);
 assert.equal(kartuStokCandidates({ SHEET_ID_2026: 'same', SHEET_ID_INVENTORY: 'same' }).length, 1);
});
test('explicit source never falls back to another spreadsheet and missing/unauthorized sources fail closed', async () => {
 const explicit = { ...env, SHEET_ID_KARTU_STOK: 'stock-only' };
 assert.deepEqual(kartuStokCandidates(explicit), [{ id: 'stock-only', label: 'SHEET_ID_KARTU_STOK' }]);
 const seen = [];
 await assert.rejects(readKartuStock(explicit, async id => { seen.push(id); throw new GoogleAccessError('SHEET_TAB_MISSING','Missing'); }), error => error.code === 'KARTU_STOK_SOURCE_MISSING');
 assert.deepEqual(seen, ['stock-only']);
 let attempts = 0;
 await assert.rejects(readKartuStock(env, async () => { attempts++; throw new GoogleAccessError('SHEETS_PERMISSION_DENIED','Denied'); }), error => error.code === 'SHEETS_PERMISSION_DENIED');
 assert.equal(attempts, 1);
});
test('Google check accepts separate Inventory/Kartu Stock and transaction spreadsheets', async () => {
 const reply = await handleGoogleCheck('cek google', env, async url => {
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test' });
  if (url.endsWith('/userinfo')) return Response.json({ email: 'user@test.invalid' });
  const titles = url.includes('/transactions?') ? ['Barang Masuk','Barang KeIuar'] : ['Movement','Kartu Stock'];
  return Response.json({ sheets: titles.map(title => ({ properties: { title } })) });
 });
 assert.match(reply, /Kartu Stock: tersedia di SHEET_ID_INVENTORY/); assert.doesNotMatch(reply, /Tab belum ditemukan/);
});
test('outbound checks Inventory stock but writes only to the transactions spreadsheet', async () => {
 const state = { direction: 'out', qty: 5, available: 12, location: 'A20-1', pic: 'ABI', profile: { id: 'user-id', full_name: 'Andi' }, nonce: 'reference', row: { sku: '00123', nama_barang: 'Merlyn' } };
 const reads = [], writes = [];
 const result = await commitStock(env, state, async (url, options = {}) => {
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test' });
  const decoded = decodeURIComponent(url);
  if (options.method === 'PUT') { writes.push(url); return Response.json({}); }
  reads.push(url);
  if (decoded.includes('Kartu Stock')) { assert.match(url, /\/inventory\/values\//); return Response.json({ values: [['LOKASI BULKY','SKU','NAMA BARANG','STOK AKHIR'],['A20-1','00123','Merlyn',12]] }); }
  assert.match(url, /\/transactions\/values\//);
  if (/!A2:I2/.test(decoded)) return Response.json({ values: [] });
  return Response.json({ values: [['TANGGAL','FROM','TO','SKU','NAMA BARANG','QTY','STATUS','PIC','KETERANGAN']] });
 });
 assert.equal(result.saved, true); assert.equal(writes.length, 1); assert.match(writes[0], /\/transactions\/values\//); assert.equal(reads.length, 3);
});
