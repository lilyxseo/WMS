import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = () => readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

test('Cari Data scan normalizes the SKU string and navigates directly to detail', async () => {
  const source = await mainSource();
  const handler = source.slice(source.indexOf('function handleSearchScanResult'), source.indexOf('async function openBarcodeScanner'));

  assert.match(handler, /const sku=normalizeScannedSku\(scannedValue\)/);
  assert.match(handler, /navigateTo\(`\/sku\/\$\{encodeURIComponent\(sku\)\}`\)/);
  assert.doesNotMatch(handler, /resolveScannedSku|runSearch|triggerSearchSku|lastResults|CACHE_SKU|mode=full|Number\s*\(/);
});

test('Cari Data scan has a short duplicate-navigation lock', async () => {
  const source = await mainSource();
  const state = source.slice(source.indexOf('const SCANNER_STATE'), source.indexOf('const BALIKAN_AUTO_CHECK_KEY'));
  const handler = source.slice(source.indexOf('function handleSearchScanResult'), source.indexOf('async function openBarcodeScanner'));

  assert.match(state, /SEARCH_SCAN_NAVIGATION_LOCK_MS=750/);
  assert.match(handler, /lastSearchSku===sku/);
  assert.match(handler, /now-SCANNER_STATE\.lastSearchNavigationAt<SEARCH_SCAN_NAVIGATION_LOCK_MS/);
  assert.ok(handler.indexOf('lastSearchNavigationAt=now') < handler.indexOf('navigateTo('));
});

test('manual search remains the debounced flexible-search flow', async () => {
  const source = await mainSource();
  const bindingsStart = source.indexOf('function bindEvents');
  const bindings = source.slice(bindingsStart, bindingsStart + 500);

  assert.match(bindings, /searchInput\?\.addEventListener\("input",e=>scheduleSearchFilter/);
  assert.doesNotMatch(bindings, /searchInput\?\.addEventListener\("input"[^;]*navigateTo/);
});

test('SKU detail renders loading and genuine not-found states around its own direct fetch', async () => {
  const source = await mainSource();
  const loader = source.slice(source.indexOf('async function showDetail'), source.indexOf('function renderSkuDetailPayload'));

  assert.ok(loader.indexOf('Memuat detail SKU...') < loader.indexOf('fetchJsonSafe('));
  assert.match(loader, /\/api\/inventory-sku-detail\?sku=/);
  assert.match(loader, /SKU \$\{sku\} tidak ditemukan\./);
});
