import test from 'node:test';
import assert from 'node:assert/strict';
import { readSheetValues } from '../supabase/functions/whatsapp-fonnte/sheet-values.js';
import { googleResponseError } from '../supabase/functions/whatsapp-fonnte/google-errors.js';
const options = { id: 'inventory', range: "'Kartu Stock'!A:AZ", label: 'SHEET_ID_INVENTORY', headers: {} };

test('large stock reads use bounded batches without losing row offsets or exceeding the actual grid', async () => {
 const calls = [];
 const result = await readSheetValues({ ...options, fetchFn: async (url, init) => {
  assert.equal(init.method, undefined); calls.push(decodeURIComponent(url));
  if (url.includes('?fields=')) return Response.json({ sheets: [{ properties: { title: 'Kartu Stock', gridProperties: { rowCount: 2005, columnCount: 9 } } }] });
  const decoded = decodeURIComponent(url);
  if (decoded.includes('!A:AZ')) return Response.json({ error: { message: 'Requested data exceeds maximum allowed size' } }, { status: 400 });
  if (decoded.includes('!A1:I1000')) return Response.json({ values: [['Header']] });
  if (decoded.includes('!A1001:I2000')) return Response.json({ values: [['Later row']] });
  if (decoded.includes('!A2001:I2005')) return Response.json({ values: [] });
  throw new Error('Unexpected request');
 } });
 assert.equal(result.length, 1001); assert.deepEqual(result[0], ['Header']); assert.deepEqual(result[999], []); assert.deepEqual(result[1000], ['Later row']); assert.equal(calls.length, 5);
});
test('grid overflow is classified separately and rejected reads report their tab without echoing server payloads', async () => {
 const error = await googleResponseError(Response.json({ error: { message: 'Range exceeds grid limits. private payload' } }, { status: 400 }));
 assert.equal(error.code, 'SHEETS_GRID_LIMIT'); assert.doesNotMatch(error.userMessage, /private payload/);
 let requests = 0;
 await assert.rejects(readSheetValues({ ...options, fetchFn: async () => { requests++; return Response.json({ error: { message: 'private payload' } }, { status: 400 }); } }), error => {
  assert.equal(error.code, 'GOOGLE_HTTP_400'); assert.match(error.userMessage, /Tahap: membaca Kartu Stock \(SHEET_ID_INVENTORY\)/); assert.doesNotMatch(error.userMessage, /private payload/); assert.equal(error.writeAttempted, false); return true;
 });
 assert.equal(requests, 1);
});
test('a failed later batch aborts the read rather than returning partial stock', async () => {
 let batches = 0;
 await assert.rejects(readSheetValues({ ...options, fetchFn: async url => {
  if (url.includes('?fields=')) return Response.json({ sheets: [{ properties: { title: 'Kartu Stock', gridProperties: { rowCount: 2000, columnCount: 8 } } }] });
  if (decodeURIComponent(url).includes('!A:AZ')) return Response.json({ error: { message: 'Range exceeds grid limits' } }, { status: 400 });
  if (++batches === 1) return Response.json({ values: [['stock']] });
  return Response.json({}, { status: 403 });
 } }), error => error.code === 'SHEETS_PERMISSION_DENIED' && error.writeAttempted === false);
 assert.equal(batches, 2);
});

test('full transaction tabs gain row capacity before rechecking the target row, without writing values', async () => {
 const { readTransactionRow } = await import('../supabase/functions/whatsapp-fonnte/sheet-values.js');
 const calls = [];
 let grown = false;
 const result = await readTransactionRow({ id: 'transactions', sheet: 'Barang Masuk', rowNumber: 101, label: 'SHEET_ID_2026', headers: {}, fetchFn: async (url, init) => {
  calls.push({ url, method: init.method });
  if (url.includes('?fields=')) return Response.json({ sheets: [{ properties: { sheetId: 7, title: 'Barang Masuk', gridProperties: { rowCount: 100, columnCount: 15 } } }] });
  if (url.endsWith(':batchUpdate')) {
   assert.deepEqual(JSON.parse(init.body).requests, [{ appendDimension: { sheetId: 7, dimension: 'ROWS', length: 1 } }]); grown = true; return Response.json({});
  }
  assert.match(decodeURIComponent(url), /'Barang Masuk'!A101:I101/);
  return grown ? Response.json({ values: [] }) : Response.json({ error: { message: 'Range exceeds grid limits' } }, { status: 400 });
 } });
 assert.deepEqual(result, []); assert.deepEqual(calls.map(call => call.method), [undefined, undefined, 'POST', undefined]);
});
test('denied row expansion stops before any transaction values are written', async () => {
 const { readTransactionRow } = await import('../supabase/functions/whatsapp-fonnte/sheet-values.js');
 let valueReads = 0;
 await assert.rejects(readTransactionRow({ id: 'transactions', sheet: 'Barang Masuk', rowNumber: 101, label: 'SHEET_ID_2026', headers: {}, fetchFn: async (url, init) => {
  if (url.includes('?fields=')) return Response.json({ sheets: [{ properties: { sheetId: 7, title: 'Barang Masuk', gridProperties: { rowCount: 100, columnCount: 15 } } }] });
  if (init.method === 'POST') return Response.json({}, { status: 403 });
  assert.equal(init.method, undefined); valueReads++;
  return Response.json({ error: { message: 'Range exceeds grid limits' } }, { status: 400 });
 } }), error => error.code === 'SHEETS_PERMISSION_DENIED' && error.writeAttempted === false);
 assert.equal(valueReads, 1);
});

test('transaction slot scan stops at the first blank Tanggal/SKU and never reads unbounded columns', async () => {
 const { findTransactionSlot } = await import('../supabase/functions/whatsapp-fonnte/sheet-values.js');
 let calls = 0;
 const result = await findTransactionSlot({ id: 'transactions', sheet: 'Barang Masuk', label: 'SHEET_ID_2026', headers: {}, fetchFn: async url => {
  calls++; const decoded = decodeURIComponent(url);
  if (calls === 1) {
   assert.match(decoded, /!A1:I500/);
   return Response.json({ values: [['TANGGAL'], ...Array.from({ length: 499 }, () => ['date', '', '', 'SKU'])] });
  }
  assert.match(decoded, /!A501:I1000/);
  return Response.json({ values: [['date', '', '', 'SKU'], ['', 'template'], ['later', '', '', 'LATER']] });
 } });
 assert.equal(calls, 2); assert.equal(result.rowNumber, 502);
});
test('short transaction grids are clamped before finding the first row', async () => {
 const { findTransactionSlot } = await import('../supabase/functions/whatsapp-fonnte/sheet-values.js');
 const result = await findTransactionSlot({ id: 'transactions', sheet: 'Barang Masuk', label: 'SHEET_ID_2026', headers: {}, fetchFn: async url => {
  if (url.includes('?fields=')) return Response.json({ sheets: [{ properties: { title: 'Barang Masuk', gridProperties: { rowCount: 3, columnCount: 9 } } }] });
  if (decodeURIComponent(url).includes('!A1:I500')) return Response.json({ error: { message: 'Range exceeds grid limits' } }, { status: 400 });
  assert.match(decodeURIComponent(url), /!A1:I3/); return Response.json({ values: [['TANGGAL'], ['date', '', '', 'SKU'], ['date', '', '', 'SKU']] });
 } });
 assert.equal(result.rowNumber, 4);
});
