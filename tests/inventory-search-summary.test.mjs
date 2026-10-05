import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { groupInventorySearchRows } from '../functions/api/inventory-search.js';

test('search results aggregate stock and locations for the quick SKU preview', () => {
  const grouped = groupInventorySearchRows([
    { sku: '682200001663', nama: 'Hair Straightener', source: 'Kartu Stock', qty: '12', location: 'A-01' },
    { sku: '682200001663', nama: 'Hair Straightener', source: 'Kartu Stock', qty: '8', location: 'A-02' },
    { sku: '682200001663', nama: 'Hair Straightener', source: 'RPL', qty: '3', location: 'R-01' },
    { sku: '682200001663', nama: 'Hair Straightener', source: 'BULKY', qty: '1,200', location: 'B-01' },
    { sku: '682200001663', nama: 'Hair Straightener', source: 'Barang Masuk', qty: '999', location: 'ignored' },
  ]);
  const item = grouped.get('682200001663');
  assert.deepEqual(item.summary.distribution, { 'Kartu Stock': 20, RPL: 3, BULKY: 1200 });
  assert.deepEqual(item.summary.locations, ['A-01', 'A-02', 'R-01', 'B-01']);
  assert.deepEqual(item.sources, ['Kartu Stock', 'RPL', 'BULKY', 'Barang Masuk']);
});

test('inventory search requests the fields needed by quick preview and frontend consumes its summary', async () => {
  const apiSource = await readFile(new URL('../functions/api/inventory-search.js', import.meta.url), 'utf8');
  const frontendSource = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  assert.match(apiSource, /sku,nama_barang,lokasi_bulky,stok_akhir/);
  assert.match(frontendSource, /item\.summary\?\.distribution/);
  assert.match(frontendSource, /item\.summary\?\.locations/);
});
