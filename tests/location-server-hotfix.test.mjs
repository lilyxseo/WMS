import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestGet as getSummary } from '../functions/api/location-summary.js';
import { onRequestGet as getLocations } from '../functions/api/locations/index.js';
import { onRequestGet as getEmptyLocations } from '../functions/api/locations/empty.js';

const main = readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase_location_queries.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260916000000_location_queries.sql', import.meta.url), 'utf8');

test('Location route renders its shell without global inventory hydration', () => {
  const showPage = main.slice(main.indexOf('function showPage('), main.indexOf('function pageTitleFromPath'));
  assert.match(showPage, /page==="locations"\)\{setMainContentLoading\(false\);renderLocationsPage/);
  assert.doesNotMatch(showPage.slice(showPage.indexOf('page==="locations"'), showPage.indexOf('page==="barang-masuk"')), /hydrateAllDataOnInit|preloadData|mode=.?full/);
  assert.match(main, /location\.pathname==="\/lokasi"[^}]+hideInitialLoader/);
});

test('Location UI uses independently paginated server APIs and bounded caches', () => {
  const section = main.slice(main.indexOf('const LOCATION_CACHE_LIMIT='), main.indexOf('function getRecentSearches'));
  assert.match(section, /LOCATION_CACHE_LIMIT=8/);
  assert.match(section, /\/api\/location-summary/);
  assert.match(section, /\/api\/locations\?/);
  assert.match(section, /\/api\/locations\/empty\?/);
  assert.match(section, /\/api\/location-detail\?/);
  assert.match(section, /debounce\([^]*,400\)/);
  assert.doesNotMatch(section, /prefetchLocationPage|requestIdleCallback/);
  assert.match(section, /LOCATION_STATE\.pageSize=25/);
  assert.doesNotMatch(section, /DATA\[|CACHE_SKU|IndexedDB|hydrateAllDataOnInit|preloadData|mode=.?full|buildLocationRows/);
});

test('database functions aggregate, sort and paginate before transfer', () => {
  assert.equal(migration, sql);
  assert.match(sql, /inventory_kartu_stok/);
  assert.match(sql, /having sum\(coalesce\(ks\.stok_akhir, 0\)\) > 0/);
  assert.match(sql, /count\(distinct sku\)/);
  assert.match(sql, /limit least\(greatest\(p_limit,1\),25\)/);
  assert.match(sql, /p_sort='sku-desc'/);
  assert.doesNotMatch(sql, /select \*/i);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

test('Location API enforces the 25-row contract and exposes safe timing diagnostics', () => {
  const helper = readFileSync(new URL('../functions/api/_locations.js', import.meta.url), 'utf8');
  const list = readFileSync(new URL('../functions/api/locations/index.js', import.meta.url), 'utf8');
  assert.match(list, /boundedInt\(u\.searchParams\.get\('limit'\),25,25\)/);
  assert.match(helper, /\[LocationAPI\].*authMs=.*dbMs=.*returnedRows=.*payloadBytes=.*totalMs=/);
  assert.match(helper, /Server-Timing/);
  assert.doesNotMatch(helper, /console\.(?:info|log)\([^\n]*(?:apikey|Authorization)/);
});

const locationContext = path => ({
  request: new Request(`https://warehouse.test${path}`, { headers: { 'x-preview-bypass-login': 'true' } }),
  env: { PREVIEW_BYPASS_LOGIN: 'true', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' },
});

test('all deployed Location routes return valid HTTP 200 JSON from their RPC', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).endsWith('/location_summary')) return Response.json({ totalLocations: 776, totalLocatedSku: 3000, emptyLocations: 20 });
    return Response.json({ rows: [{ lokasi: 'A01-1', jumlahSku: 3, totalQty: 12, status: 'Normal' }], total: 1, page: 1, limit: 25 });
  };

  for (const [handler, path] of [[getSummary, '/api/location-summary'], [getLocations, '/api/locations?page=1&limit=25'], [getEmptyLocations, '/api/locations/empty?page=1&limit=25']]) {
    const response = await handler(locationContext(path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal((await response.json()).success, true);
  }
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/rest/v1/rpc/location_summary', '/rest/v1/rpc/location_list', '/rest/v1/rpc/location_empty']);
  assert.equal(calls[1].body.p_limit, 25);
  assert.equal(calls[2].body.p_limit, 25);
});

test('missing production migration preserves the frontend message and reports PGRST202 clearly', async t => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const errors = [];
  t.after(() => { globalThis.fetch = originalFetch; console.error = originalError; });
  console.error = (...args) => errors.push(args);
  globalThis.fetch = async () => Response.json({ code: 'PGRST202', message: 'Could not find the function public.location_summary in the schema cache' }, { status: 404 });
  const response = await getSummary(locationContext('/api/location-summary'));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.deepEqual(body, { success: false, message: 'Gagal memuat ringkasan lokasi', code: 'LOCATION_RPC_MISSING' });
  assert.equal(errors[0][1].code, 'PGRST202');
  assert.match(errors[0][1].stack, /callLocationRpc/);
});
