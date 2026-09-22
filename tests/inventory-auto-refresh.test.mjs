import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const frontend = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const endpoint = await readFile(new URL('../functions/api/inventory-version.js', import.meta.url), 'utf8');

test('inventory version endpoint returns metadata only and remains authenticated', () => {
  assert.match(endpoint, /getRequestRole/);
  assert.match(endpoint, /barangMasukVersion/);
  assert.match(endpoint, /barangKeluarVersion/);
  assert.match(endpoint, /rplVersion/);
  assert.match(endpoint, /bulkyVersion/);
  assert.match(endpoint, /select=synced_at/);
  assert.doesNotMatch(endpoint, /select=\*/);
});

test('version watcher pauses when hidden or offline and checks lifecycle signals', () => {
  assert.match(frontend, /INVENTORY_VERSION_CHECK_INTERVAL_MS=45\*1000/);
  assert.match(frontend, /document\.hidden\|\|navigator\.onLine===false/);
  assert.match(frontend, /visibilitychange/);
  assert.match(frontend, /window\.addEventListener\('focus'/);
  assert.match(frontend, /window\.addEventListener\('online'/);
  assert.match(frontend, /window\.addEventListener\('offline'/);
});

test('route refresh is scoped, abortable, and preserves transaction view state', () => {
  assert.match(frontend, /clearSource\('barang_masuk'\)/);
  assert.match(frontend, /clearSource\('barang_keluar'\)/);
  assert.match(frontend, /page:TABLE_STATE\.in\.page,force:true,background:true/);
  assert.match(frontend, /page:TABLE_STATE\.out\.page,force:true,background:true/);
  assert.match(frontend, /rerenderTableWithScrollRestore\(mode,true\)/);
  assert.match(frontend, /new AbortController\(\)/);
  assert.match(frontend, /generation!==INVENTORY_VERSION_STATE\.generation/);
  assert.doesNotMatch(frontend.slice(frontend.indexOf('async function checkInventoryVersion'), frontend.indexOf('async function loadAllData')), /location\.reload|mode=full/);
});
