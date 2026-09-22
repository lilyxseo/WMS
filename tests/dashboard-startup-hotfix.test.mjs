import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

function bodyBetween(start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test('dashboard initialization starts its lightweight prioritized prefetch', () => {
  const init = bodyBetween('async function initAppData()', 'async function refreshDataInBackground()');
  const landing = init.slice(0, init.indexOf('await hydrateModuleCachesFromDb()'));
  assert.match(landing, /void startInitialPrefetch\(\)/);
  assert.match(landing, /void loadInventorySyncStatus\(\)/);
  assert.doesNotMatch(landing, /hydrateAllDataOnInit|preloadData|mode=['"]full|BARCODE/);

  const summary = bodyBetween('async function loadDashboardSummary()', 'async function loadDetailPageData(page)');
  assert.match(summary, /fetchJsonSafe\('\/api\/dashboard-summary'/);
  assert.match(summary, /DASHBOARD_SUMMARY=data\.summary/);
  assert.match(summary, /updateDashboard\(\)/);
  assert.ok(summary.indexOf('DASHBOARD_SUMMARY=data.summary') < summary.indexOf('updateDashboard()'));
});

test('dashboard refresh only refetches dashboard summary', () => {
  const refresh = bodyBetween('async function triggerManualRefresh()', 'function syncRefreshButton()');
  const dashboardBranch = refresh.slice(refresh.indexOf("activePage==='dashboard'"), refresh.indexOf("activePage==='balikan-store'"));
  assert.match(dashboardBranch, /loadDashboardPayload\(\)/);
  assert.doesNotMatch(dashboardBranch, /loadAllData|hydrateAllDataOnInit|loadBarcodeMaster|mode=.?full|syncData/);
});

test('movement detail routes lazy-load independently', () => {
  const loader = bodyBetween('async function loadDetailPageData(page)', 'async function initAppData()');
  assert.match(loader, /page==='barang-masuk'.*loadTransactionTablePage\('in',\{page:TABLE_STATE.in.page\}\)/);
  assert.match(loader, /page==='barang-keluar'.*loadTransactionTablePage\('out',\{page:TABLE_STATE.out.page\}\)/);
  const showPage = bodyBetween('function showPage(page)', 'function pageTitleFromPath(path)');
  assert.match(showPage, /loadDetailPageData\(page\)/);
});

test('barcode master is not loaded at startup or when scanner opens', () => {
  const rebuild = bodyBetween('function rebuildBarcodeMap(rows=[])', 'function detectHeaderIndex(values)');
  assert.doesNotMatch(rebuild, /localStorage\.setItem|inventory_barcode_master/);
  const startupHydration = bodyBetween('async function hydrateAllDataOnInit', 'function preloadInventoryData()');
  assert.doesNotMatch(startupHydration, /loadBarcodeMaster|BARCODE/);
  const scanner = bodyBetween('async function openBarcodeScanner', 'async function openScannerModal');
  assert.doesNotMatch(scanner, /loadBarcodeMaster|fetchSheet\(["']BARCODE["']\)|mode=.?full/);
});
