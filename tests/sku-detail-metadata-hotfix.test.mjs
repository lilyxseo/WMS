import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { handleInventorySkuDetailRequest, toSkuDetailRow } from '../functions/api/inventory-sku-detail.js';

test('SKU Detail API projection removes every metadata spelling without removing business fields', () => {
  const row = toSkuDetailRow({ SKU: 'A-1', qty: 4, ROWNUMBER: 1, row_number: 2, rowNumber: 3, SOURCE_ROW_NUMBER: 4, sourceRowNumber: 5, synced_at: 'now', syncedAt: 'later' });
  assert.deepEqual(row, { SKU: 'A-1', qty: 4 });
});

test('SKU Detail renderer filters metadata cells case-insensitively for every section', () => {
  const source = fs.readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const constants = source.match(/const SKU_DETAIL_INTERNAL_COLUMNS=[^;]+;/)?.[0];
  const predicate = source.match(/function isSkuDetailInternalColumn\([^\n]+/)?.[0];
  const helper = source.match(/function getSkuDetailVisibleCells\([^\n]+/)?.[0];
  assert.ok(constants && predicate && helper);
  const context = {};
  vm.runInNewContext(`${constants}${predicate}${helper};result=getSkuDetailVisibleCells`, context);
  const cells = context.result({ tanggal: '2026-09-16', lokasi: 'A01', ROWNUMBER: 1, sourceRowNumber: 2, SYNCED_AT: 'now' });
  assert.deepEqual(Object.keys(cells), ['tanggal', 'lokasi']);
  const render = source.slice(source.indexOf('function renderSkuDetailTable'), source.indexOf('function renderTable'));
  assert.match(render, /getSkuDetailVisibleCells/);
});

test('SKU Detail endpoint selects bounded source fields and does not return metadata', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify([{ lokasi_bulky: 'A01', sku: 'A-1', nama_barang: 'Produk', qty: 2, source_row_number: 8, synced_at: 'now' }]));
  };
  try {
    const response = await handleInventorySkuDetailRequest({
      request: new Request('https://app.example/api/inventory-sku-detail?sku=A-1', { headers: { 'x-preview-bypass-login': 'true' } }),
      env: { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only', PREVIEW_BYPASS_LOGIN: 'true' },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(urls.every(url => new URL(url).searchParams.get('select') !== '*'));
    for (const rows of Object.values(body.sources)) {
      for (const row of rows) assert.ok(Object.keys(row).every(key => !/^(row_?number|source_?row_?number|synced_?at)$/i.test(key)));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
