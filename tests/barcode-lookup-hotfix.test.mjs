import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildExactLookupQuery, normalizeBarcode, parseVisualizationResponse } from '../functions/api/barcode-lookup.js';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const endpoint = await readFile(new URL('../functions/api/barcode-lookup.js', import.meta.url), 'utf8');

test('barcode normalization removes surrounding whitespace and scanner controls', () => {
  assert.equal(normalizeBarcode('\n\u0002123456789012\r'), '123456789012');
});

test('barcode master query is exact, limited, and safely quotes values', () => {
  assert.equal(buildExactLookupQuery("12'34", ['B', 'D']), "select A where B = '12''34' or D = '12''34' limit 1");
  assert.doesNotMatch(buildExactLookupQuery('123', ['B']), /contains|matches/i);
});

test('visualization response exposes only the resolved SKU', () => {
  const body = 'google.visualization.Query.setResponse({"status":"ok","table":{"rows":[{"c":[{"v":"682200005566"}]}]}});';
  assert.equal(parseVisualizationResponse(body), '682200005566');
});

test('protected endpoint performs barcode-first lookup and optional exact SKU fallback', () => {
  assert.match(endpoint, /getRequestRole\(request, env\)/);
  assert.match(endpoint, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(endpoint, /buildExactLookupQuery\(barcode, barcodeColumns\(env\)\)/);
  assert.match(endpoint, /SKU_PATTERN\.test\(barcode\)/);
  assert.match(endpoint, /buildExactLookupQuery\(barcode, \['A'\]\)/);
  assert.doesNotMatch(endpoint, /mode=.?full|values\/.*A1:ZZ/);
});

test('Cari Data scan uses direct authenticated lookup without triggering normal search', () => {
  const start = source.indexOf('async function handleSearchScanResult');
  const end = source.indexOf('async function openBarcodeScanner', start);
  assert.notEqual(start, -1);
  const handler = source.slice(start, end);
  assert.match(handler, /lookupBarcodeExact\(scanned\)/);
  assert.match(handler, /navigateToSku\(sku\)/);
  assert.match(handler, /Barcode tidak ditemukan/);
  assert.match(handler, /Gagal mencari barcode/);
  assert.match(handler, /lookupInFlight/);
  assert.match(handler, /<800/);
  assert.doesNotMatch(handler, /triggerSearchSku|runSearch|lastResults|mode=.?full/);
  const lookup = source.slice(source.indexOf('async function lookupBarcodeExact'), start);
  assert.match(lookup, /getAuthHeaders\(\)/);
  assert.match(lookup, /headers\.Authorization/);
  assert.match(lookup, /\/api\/barcode-lookup\?barcode=/);
});
