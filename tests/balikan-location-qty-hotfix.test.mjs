import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aggregateLocationInventory,
  LOCATION_INVENTORY_QTY_FIELD,
  LOCATION_INVENTORY_TABLE,
  parseInventoryQty,
} from '../functions/api/balikan-store/_location-inventory.js';

test('Balikan location inventory uses authoritative Kartu Stok closing stock', () => {
  assert.equal(LOCATION_INVENTORY_TABLE, 'inventory_kartu_stok');
  assert.equal(LOCATION_INVENTORY_QTY_FIELD, 'stok_akhir');
});

test('location rows aggregate by normalized SKU and location', () => {
  const result = aggregateLocationInventory([
    { sku: '682200006044', lokasi_bulky: 'E13-1', stok_akhir: '4', source_row_number: 10 },
    { sku: '682200006044', lokasi_bulky: 'e13-1', stok_akhir: '2.000', source_row_number: 11 },
    { sku: '682200006044', lokasi_bulky: 'F01-2', stok_akhir: 3, source_row_number: 12 },
  ]);
  assert.deepEqual(result['682200006044'].map(row => [row.lokasi, row.qty, row.rowCount]), [
    ['E13-1', 6, 2],
    ['F01-2', 3, 1],
  ]);
});

test('real zero remains zero while blank or invalid stock remains missing', () => {
  assert.equal(parseInventoryQty(0), 0);
  assert.equal(parseInventoryQty('0'), 0);
  assert.equal(parseInventoryQty(null), null);
  assert.equal(parseInventoryQty(''), null);
  assert.equal(parseInventoryQty('not-a-number'), null);
  const result = aggregateLocationInventory([
    { sku: 'ZERO', lokasi_bulky: 'A01-1', stok_akhir: '0' },
    { sku: 'MISSING', lokasi_bulky: 'A01-2', stok_akhir: null },
  ]);
  assert.equal(result.zero[0].qty, 0);
  assert.equal(result.missing[0].qty, null);
});

test('frontend consumes backend locations and never invents zero for a missing qty', () => {
  const source = readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function getBalikanSkuLocationOptions(row)');
  const end = source.indexOf('\nfunction getBalikanLocationCardRow', start);
  const lookup = source.slice(start, end);
  assert.match(lookup, /Array\.isArray\(row\?\.locations\)/);
  assert.doesNotMatch(lookup, /DATA\["Kartu Stock"\]/);
  assert.match(lookup, /qty=null/);
  assert.match(source, /qtyLabel=item\.qty===null\|\|item\.qty===undefined\?'—'/);
});
