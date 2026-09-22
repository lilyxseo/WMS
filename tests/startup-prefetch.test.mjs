import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

test('pre-auth preparation touches only static shell metadata and a route module', () => {
  const section = source.slice(source.indexOf('function preparePublicShell'), source.indexOf('function isConstrainedConnection'));
  assert.doesNotMatch(section, /fetch\(|\/api\//);
  assert.match(section, /requestIdleCallback/);
});

test('authenticated startup uses bounded priority queues and first-page requests', () => {
  const section = source.slice(source.indexOf('async function startInitialPrefetch'), source.indexOf('async function startBackgroundPreload'));
  assert.match(section, /if\(!isAuthStateReady\|\|!user\)return null/);
  assert.match(section, /if\(!authHeaders\.Authorization\)return null/);
  assert.match(section, /priority1/);
  assert.match(section, /concurrency:2/);
  assert.doesNotMatch(section, /mode=full|hydrateAllDataOnInit|preloadMainData/);
});

test('startup prefetch is network/visibility aware and logout cancels user work', () => {
  assert.match(source, /saveData===true/);
  assert.match(source, /waitUntilVisible/);
  const logout = source.slice(source.indexOf('window.addEventListener("auth:logout"'), source.indexOf('function bindLoginView'));
  assert.match(logout, /cancelStartupPrefetch\(\)/);
  assert.match(logout, /TRANSACTION_PAGE_CACHE\.clearSource\('barang_masuk'\)/);
  assert.match(logout, /LOCATION_STATE\.pageCache\.clear\(\)/);
});
