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
  assert.match(section, /prefetchLocationPage\(page\+1\)/);
  assert.doesNotMatch(section, /DATA\[|CACHE_SKU|IndexedDB|hydrateAllDataOnInit|preloadData|mode=.?full|buildLocationRows/);
});

test('database functions aggregate, sort and paginate before transfer', () => {
  assert.match(sql, /inventory_kartu_stok/);
  assert.match(sql, /having sum\(coalesce\(stok_akhir, 0\)\) > 0/);
  assert.match(sql, /count\(distinct sku\)/);
  assert.match(sql, /offset \(greatest\(p_page,1\)-1\)\*p_limit limit p_limit/);
  assert.match(sql, /p_sort='sku-desc'/);
  assert.doesNotMatch(sql, /select \*/i);
});
