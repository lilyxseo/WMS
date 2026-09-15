import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const recent = await readFile(new URL('../functions/api/dashboard-recent-transactions.js', import.meta.url), 'utf8');
const monthly = await readFile(new URL('../functions/api/dashboard-monthly-insight.js', import.meta.url), 'utf8');
const masuk = await readFile(new URL('../functions/api/barang-masuk/index.js', import.meta.url), 'utf8');
const keluar = await readFile(new URL('../functions/api/barang-keluar/index.js', import.meta.url), 'utf8');

test('dashboard restores both latest-50 tables and monthly insight without full mode', () => {
  const dashboardLoaders = main.slice(main.indexOf('async function loadDashboardSummary()'), main.indexOf('function renderInventorySyncStatus()'));
  assert.match(dashboardLoaders, /dashboard-recent-transactions/);
  assert.match(dashboardLoaders, /dashboard-monthly-insight/);
  assert.doesNotMatch(dashboardLoaders, /mode=full/);
  assert.match(recent, /order=tanggal\.desc,source_row_number\.desc&limit=50/g);
  assert.match(monthly, /Auto Insight Bulanan/);
  assert.match(main, /renderDashboardTableSection\("Barang Masuk"[\s\S]*renderDashboardTableSection\("Barang Keluar"/);
});

test('normal transaction routes request a server page and preserve backend totals', () => {
  const loader = main.slice(main.indexOf('async function loadTransactionTablePage'), main.indexOf('function normalizeMovementRows'));
  assert.match(loader, /URLSearchParams\(\{page:String\(nextPage\),limit:String\(nextLimit\)\}\)/);
  assert.match(loader, /st\.total=Number\(data\.total\)/);
  assert.match(loader, /st\.summary=data\.summary/);
  assert.doesNotMatch(loader, /mode=full|slice\(/);
  for (const source of [masuk, keluar]) {
    assert.match(source, /offset = \(page - 1\) \* limit/);
    assert.match(source, /transactionSummary\(supabaseConfig, TABLE, filterQuery\)/);
  }
});

test('table search resets page one and is sent to the backend', () => {
  assert.match(main, /loadTransactionTablePage\("in",\{page:1,search:inSearch\?\.value\}\)/);
  assert.match(main, /loadTransactionTablePage\("out",\{page:1,search:outSearch\?\.value\}\)/);
  assert.match(main, /if\(q\)params\.set\('q',q\)/);
});
