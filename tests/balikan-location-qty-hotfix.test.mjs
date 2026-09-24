import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLocationRows, BALIKAN_LOCATION_SOURCE, parseInventoryQuantity } from '../functions/api/balikan-store/locations.js';

const rows = [
  { lokasi_bulky: 'E13-1', stok_akhir: '4.000' },
  { lokasi_bulky: 'e13-1', stok_akhir: '2.000' },
  { lokasi_bulky: 'ZERO-1', stok_akhir: 0 },
  { lokasi_bulky: 'MISSING-1', stok_akhir: null },
];

test('Balikan uses authoritative Kartu Stok fields', () => {
  assert.deepEqual(BALIKAN_LOCATION_SOURCE, { table: 'public.inventory_kartu_stok', locationField: 'lokasi_bulky', quantityField: 'stok_akhir' });
});

test('location rows aggregate stock and preserve zero versus missing', () => {
  assert.deepEqual(aggregateLocationRows(rows), [
    { lokasi: 'E13-1', qty: 6, rowCount: 2 },
    { lokasi: 'ZERO-1', qty: 0, rowCount: 1 },
    { lokasi: 'MISSING-1', qty: null, rowCount: 1 },
  ]);
  assert.equal(parseInventoryQuantity('6.000'), 6);
  assert.equal(parseInventoryQuantity(''), null);
  assert.equal(parseInventoryQuantity('not-a-number'), null);
});

test('frontend renders missing qty separately from actual zero', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  assert.match(source, /item\.qty===null\?'—':`\$\{item\.qty\} pcs`/);
  assert.doesNotMatch(source, /addLocation=\(lokasi,qty=0\)/);
  assert.match(source, /\/api\/balikan-store\/locations\?sku=/);
});
