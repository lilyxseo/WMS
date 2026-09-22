import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadOutboundWithoutInbound, mapOutboundWithoutInbound } from '../functions/api/_outbound-without-inbound.js';

test('warning RPC maps one row per nonblank SKU without numeric coercion', () => {
  assert.deepEqual(mapOutboundWithoutInbound([
    { sku: '0682200005566', nama_barang: 'A' },
    { sku: '   ', nama_barang: 'missing' },
  ]).map(row => row.sku), ['0682200005566']);
});

test('warning RPC does not turn multi-location quantities into an SKU warning', () => {
  const [warning] = mapOutboundWithoutInbound([
    { sku: '682200001519', nama_barang: 'GOTO PRODUCT' },
  ]);
  assert.equal(warning.type, 'OUTBOUND_WITHOUT_INBOUND');
  assert.equal(warning.issue, 'Ada barang keluar, tetapi barang masuk belum tercatat.');
  assert.equal(warning.detail, undefined);
});

test('warning checks SKU presence and never sums quantities across locations', async () => {
  const main = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const report = main.slice(main.indexOf('function buildAnomalyReport()'), main.indexOf('function sevClass'));
  assert.doesNotMatch(report, /getSkuTotals|OUTBOUND_EXCEEDS_INBOUND/);
  const sql = await readFile(new URL('../supabase/migrations/20260922010000_fix_multilocation_outbound_warning.sql', import.meta.url), 'utf8');
  assert.match(sql, /where not exists[\s\S]*inventory_barang_masuk bm/i);
  assert.match(sql, /inventory_normalize_sku\(bm\.sku::text\) = o\.normalized_sku/i);
  assert.doesNotMatch(sql, /sum\(|inbound_qty|outbound_qty|from_location|to_location/i);
});

test('warning loader uses one backend RPC and does not download transaction datasets', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify([]), { status: 200 });
  };
  try {
    assert.deepEqual(await loadOutboundWithoutInbound({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' }), []);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/rpc\/inventory_outbound_without_inbound$/);
    assert.equal(requests[0].options.method, 'POST');
  } finally { globalThis.fetch = originalFetch; }
});

test('SQL uses one hidden-character-safe string normalizer and any inbound status is evidence', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260922000000_fix_inventory_sku_presence_normalization.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.inventory_normalize_sku/);
  for (const codePoint of [160, 8203, 8204, 8205, 8288, 65279]) assert.match(sql, new RegExp(`chr\\(${codePoint}\\)`));
  assert.match(sql, /inventory_normalize_sku\(bk\.sku::text\)/i);
  assert.match(sql, /inventory_normalize_sku\(bm\.sku::text\)/i);
  assert.match(sql, /group by public\.inventory_normalize_sku\(bk\.sku::text\)/i);
  const warningFunction = sql.slice(sql.indexOf('create or replace function public.inventory_outbound_without_inbound'), sql.indexOf('-- Targeted'));
  assert.doesNotMatch(warningFunction, /bm\.status|tanggal|qty|limit|offset/i);
  assert.doesNotMatch(sql, /parseInt|::numeric|::bigint/);
});

test('diagnostic is targeted, safe, and reports both sides from the production tables', async () => {
  const endpoint = await readFile(new URL('../functions/api/debug/inventory-sku-presence.js', import.meta.url), 'utf8');
  assert.match(endpoint, /inventory_sku_presence_debug/);
  assert.match(endpoint, /role\.includes\('developer'\).*role\.includes\('admin'\)/s);
  assert.match(endpoint, /escapedRawSkuValues/);
  assert.doesNotMatch(endpoint, /qty|tanggal|location|nama_barang/);
  const sql = await readFile(new URL('../supabase/migrations/20260922000000_fix_inventory_sku_presence_normalization.sql', import.meta.url), 'utf8');
  assert.match(sql, /public\.inventory_barang_masuk bm/);
  assert.match(sql, /public\.inventory_barang_keluar bk/);
  assert.match(sql, /'warningShouldExist'/);
});

test('warning page replaces the former browser-array rule with no-store backend results', async () => {
  const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const report = source.slice(source.indexOf('function buildAnomalyReport()'), source.indexOf('function sevClass'));
  assert.doesNotMatch(report, /type:'OUTBOUND_WITHOUT_INBOUND'/);
  const refresh = source.slice(source.indexOf('async function refreshAnomalyInBackground()'), source.indexOf('function changeAnomalyPage'));
  assert.match(refresh, /fetch\('\/api\/inventory-outbound-without-inbound'/);
  assert.match(refresh, /cache:'no-store'/);
  assert.match(refresh, /payload\.rows/);
});
