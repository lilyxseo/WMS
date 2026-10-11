import test from 'node:test';
import assert from 'node:assert/strict';
import { searchStockItems } from '../supabase/functions/whatsapp-fonnte/stock-search.js';
const config = { url: 'https://test', key: 'test' };

test('distinct SKU pagination skips duplicate locations across batches and pages', async () => {
 const data = [...Array.from({ length: 1001 }, (_, index) => ({ sku: '000', lokasi_bulky: `A${index}` })), ...Array.from({ length: 11 }, (_, index) => ({ sku: String(index + 1).padStart(3, '0') }))];
 let calls = 0;
 const fetchFn = async url => {
  calls++; const q = new URL(url).searchParams;
  assert.equal(q.get('stok_akhir'), 'gt.0'); assert.ok(q.get('or').includes('merlyn'));
  const offset = Number(q.get('offset')), limit = Number(q.get('limit'));
  return Response.json(data.slice(offset, offset + limit));
 };
 const first = await searchStockItems(config, { query: 'merlyn', direction: 'out', page: 1 }, fetchFn);
 assert.equal(first.rows.length, 10); assert.equal(first.hasMore, true); assert.equal(first.rows[0].sku, '000'); assert.equal(first.rows[9].sku, '009');
 const second = await searchStockItems(config, { query: 'merlyn', direction: 'out', page: 2 }, fetchFn);
 assert.deepEqual(second.rows.map(row => row.sku), ['010', '011']); assert.equal(second.hasMore, false); assert.equal(calls, 4);
});
