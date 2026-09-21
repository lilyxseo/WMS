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

test('SQL normalizes string SKUs, excludes blanks, deduplicates, and accepts both inbound statuses', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260921010000_outbound_without_inbound_warning.sql', import.meta.url), 'utf8');
  assert.match(sql, /upper\(btrim\(bk\.sku::text\)\)/i);
  assert.match(sql, /upper\(btrim\(coalesce\(bm\.sku::text, ''\)\)\)/i);
  assert.match(sql, /group by upper\(btrim\(bk\.sku::text\)\)/i);
  assert.match(sql, /<> ''/);
  assert.match(sql, /'BARANG MASUK', 'MOVEMENT'/);
  assert.doesNotMatch(sql, /parseInt|::numeric|::bigint/);
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
