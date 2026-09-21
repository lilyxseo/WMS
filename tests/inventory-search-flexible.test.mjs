import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventorySearchFilters, buildInventorySearchQuery, inventorySearchTokens, normalizeSearchQuery } from '../functions/api/_inventory-search.js';

test('normalizes case and repeated whitespace without coercing SKU strings', () => {
  assert.equal(normalizeSearchQuery('  YEJOON   Pen  '), 'yejoon pen');
  assert.equal(normalizeSearchQuery('  0005566  '), '0005566');
  assert.deepEqual(inventorySearchTokens(' yejoon   g18 '), ['yejoon', 'g18']);
  assert.deepEqual(inventorySearchTokens('   '), []);
});

test('builds AND-per-word and OR-per-field safe PostgREST contains filters', () => {
  const filters = buildInventorySearchFilters('yejoon g18', ['sku', 'nama_barang', 'lokasi_bulky']);
  assert.equal(filters.length, 2);
  assert.match(filters[0], /^or=\(sku\.ilike\./);
  assert.match(decodeURIComponent(filters[0]), /nama_barang\.ilike\.\*yejoon\*/);
  assert.match(decodeURIComponent(filters[1]), /lokasi_bulky\.ilike\.\*g18\*/);
  assert.equal(buildInventorySearchQuery('   ', ['sku']), '');
});

test('rejects caller-controlled field names', () => {
  assert.deepEqual(buildInventorySearchFilters('5566', ['sku', 'bad.field', 'x)or(true']), [
    'or=(sku.ilike.*5566*)',
  ]);
  assert.throws(() => buildInventorySearchFilters('x', ['bad.field']), /safe inventory search field/);
});
