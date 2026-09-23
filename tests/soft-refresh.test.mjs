import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

test('soft refresh dispatches only the active route and never reloads the browser', () => {
  assert.match(source, /const SOFT_REFRESH_ROUTES=\{[^}]*dashboard:refreshDashboard[^}]*'barang-masuk':refreshBarangMasuk[^}]*'barang-keluar':refreshBarangKeluar[^}]*locations:refreshLokasi[^}]*anomaly:refreshWarning[^}]*movement:refreshMovement[^}]*detail:\(\)=>refreshSkuDetail\(currentSku\)/s);
  const coordinator = source.slice(source.indexOf('async function triggerManualRefresh()'), source.indexOf('function syncRefreshButton()'));
  assert.match(coordinator, /const refresh=SOFT_REFRESH_ROUTES\[activePage\]/);
  assert.match(coordinator, /await refresh\(\)/);
  assert.doesNotMatch(coordinator, /location\.reload|window\.location|loadAllData|syncData/);
});

test('soft refresh is locked, reports progress, and gives success and failure feedback', () => {
  const coordinator = source.slice(source.indexOf('async function triggerManualRefresh()'), source.indexOf('function syncRefreshButton()'));
  assert.match(coordinator, /if\(REFRESH_STATE\.refreshPromise\)return REFRESH_STATE\.refreshPromise/);
  assert.match(coordinator, /setRefreshIndicator\(true,'Refreshing\.\.\.'\)/);
  assert.match(coordinator, /Data berhasil diperbarui/);
  assert.match(coordinator, /Gagal memperbarui data\./);
  assert.match(coordinator, /REFRESH_STATE\.refreshPromise=null/);
});

test('page refreshes preserve scroll and transaction query state while bypassing cache', () => {
  assert.match(source, /captureActivePageScroll\(activePage\)/);
  assert.match(source, /restoreActivePageScroll\(activePage,scrollState\)/);
  assert.match(source, /element\.scrollTop=position\.top;element\.scrollLeft=position\.left/);
  assert.match(source, /page:TABLE_STATE\[mode\]\.page,search:mode==='in'\?inSearch\?\.value:outSearch\?\.value,force:true/);
  assert.match(source, /TRANSACTION_PAGE_CACHE\.clearSource\(source\)/);
  assert.match(source, /cache:force\?'no-store':'default'/);
});

test('SKU refresh keeps existing detail visible on a failed background request', () => {
  assert.match(source, /refreshSkuDetail\(sku=currentSku\).*showDetail\(sku,\{background:true,throwOnError:true\}\)/s);
  assert.match(source, /if\(!background\)detail\.innerHTML=/);
  assert.match(source, /if\(throwOnError\)throw err/);
});
