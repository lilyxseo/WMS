import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase_location_queries.sql', import.meta.url), 'utf8');

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
  assert.match(sql, /inventory_kartu_stok/);
  assert.match(sql, /having sum\(coalesce\(stok_akhir, 0\)\) > 0/);
  assert.match(sql, /count\(distinct sku\)/);
  assert.match(sql, /limit least\(greatest\(p_limit,1\),25\)/);
  assert.match(sql, /p_sort='sku-desc'/);
  assert.doesNotMatch(sql, /select \*/i);
});

test('Location API enforces the 25-row contract and exposes safe timing diagnostics', () => {
  const helper = readFileSync(new URL('../functions/api/_locations.js', import.meta.url), 'utf8');
  const list = readFileSync(new URL('../functions/api/locations/index.js', import.meta.url), 'utf8');
  assert.match(list, /boundedInt\(u\.searchParams\.get\('limit'\),25,25\)/);
  assert.match(helper, /\[LocationAPI\].*authMs=.*dbMs=.*returnedRows=.*payloadBytes=.*totalMs=/);
  assert.match(helper, /Server-Timing/);
  assert.doesNotMatch(helper, /console\.(?:info|log)\([^\n]*(?:apikey|Authorization)/);
});
