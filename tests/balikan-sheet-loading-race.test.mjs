import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('Balikan Store waits for an explicit sheet choice instead of loading every TRIP sheet', () => {
  assert.match(source, /Pilih satu sheet TRIP untuk mulai/);
  assert.doesNotMatch(source, /loadAllBalikanTripRows/);
  assert.match(source, /reason:'sheet-required'/);
});

test('stale sheet requests cannot replace the currently selected sheet', () => {
  assert.match(source, /requestController\?\.abort\(\)/);
  assert.match(source, /requestId!==BALIKAN_STATE\.requestId\|\|requestedSheet!==window\.currentTripSheet/);
  assert.match(source, /signal:controller\.signal/);
});

test('sheet picker provides a labelled, focused single-sheet UI', () => {
  assert.match(html, /class="balikan-sheet-field"/);
  assert.match(html, /aria-label="Pilih satu sheet TRIP"/);
  assert.match(html, /Pilih satu sheet agar data dimuat lebih cepat/);
});
