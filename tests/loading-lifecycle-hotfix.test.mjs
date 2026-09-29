import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

test('affected route shells bypass global hydration', () => {
  const show = source.slice(source.indexOf('function showPage('), source.indexOf('function pageTitleFromPath'));
  for (const page of ['search', 'arsip', 'asset-store']) assert.match(show, new RegExp(`page===.${page}.`));
  assert.match(show, /setMainContentLoading\(false\)/);
});

test('page requests are finite, safely parsed and observable', () => {
  assert.match(source, /PAGE_REQUEST_TIMEOUT_MS=12000/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /fetchJsonSafe\(url/);
  for (const label of ['Dashboard', 'CariData', 'Asset', 'Arsip']) assert.match(source, new RegExp(`['"]${label}['"]`));
});

test('all affected data surfaces expose retry and soft refresh', () => {
  for (const retry of ['dashboard-summary', 'search', 'asset', 'archive']) assert.match(source, new RegExp(`data-retry-${retry}`));
  assert.match(source, /arsip:softRefreshArchive/);
  assert.match(source, /'asset-store':softRefreshAsset/);
});

test('failed metadata reads cannot recursively restart from render', () => {
  assert.match(source, /!ARCHIVE_STATE\.listError\)ensureArchiveList/);
  assert.match(source, /!ASSET_STORE_STATE\.listError\)ensureAssetStoreList/);
});
