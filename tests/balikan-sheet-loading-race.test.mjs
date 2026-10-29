import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Balikan Store offers an explicit all-TRIP option without eagerly loading it', () => {
  assert.match(source, /Pilih satu sheet TRIP untuk mulai/);
  assert.match(source, /BALIKAN_ALL_TRIP_VALUE="__all_trip__"/);
  assert.match(source, /Semua Sheet TRIP/);
  assert.match(source, /requestedSheet===BALIKAN_ALL_TRIP_VALUE/);
  assert.match(source, /reason:'sheet-required'/);
});

test('all-TRIP loading uses the batch endpoint, retains per-sheet caches and tolerates partial failure', () => {
  assert.match(source, /fetchJsonSafe\('\/api\/balikan-store\/all/);
  assert.match(source, /BALIKAN_STATE\.sheetCache\[sheet\]/);
  assert.match(source, /onProgress\?\.\(loaded\.length,sheets\.length\)/);
  assert.match(source, /result\.failures\?\.length/);
});

test('stale sheet requests cannot replace the currently selected sheet', () => {
  assert.match(source, /requestController\?\.abort\(\)/);
  assert.match(source, /requestId!==BALIKAN_STATE\.requestId\|\|requestedSheet!==window\.currentTripSheet/);
  assert.match(source, /signal:controller\.signal/);
});

test('sheet picker explains single-sheet and all-sheet modes', () => {
  assert.match(html, /class="balikan-sheet-field"/);
  assert.match(html, /aria-label="Pilih sheet TRIP"/);
  assert.match(html, /Pilih satu sheet untuk akses cepat, atau tampilkan semua sheet TRIP/);
});
