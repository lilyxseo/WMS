import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isValidMovementDate } from '../functions/api/movement/in.js';

const frontend = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

test('Movement accepts only real YYYY-MM-DD calendar dates', () => {
  assert.equal(isValidMovementDate('2026-09-15'), true);
  assert.equal(isValidMovementDate('2026-02-29'), false);
  assert.equal(isValidMovementDate('2024-02-29'), true);
  for (const value of ['15/09/2026', '09/15/2026', '15-09-2026', 'Sep 15, 2026', '2026-9-15', '2026-09-15T00:00:00.000Z']) {
    assert.equal(isValidMovementDate(value), false, value);
  }
});

test('Movement uses a native date input and sends its date-only value unchanged', () => {
  assert.match(frontend, /id='movementTanggal' type='date'/);
  assert.match(frontend, /MOVEMENT_STATE\.tanggal=localMovementDate\(\)/);
  assert.match(frontend, /const tanggal=MOVEMENT_STATE\.tanggal;/);
  assert.match(frontend, /\(\{tanggal,from:it\.lokasi/);
  assert.doesNotMatch(frontend, /const tanggal=formatTanggal\(new Date\(\)\);const items=MOVEMENT_STATE/);
});

test('Movement local default and edit normalization do not parse date-only values as instants', () => {
  assert.match(frontend, /date\.getFullYear\(\)/);
  assert.match(frontend, /date\.getMonth\(\)\+1/);
  assert.match(frontend, /date\.getDate\(\)/);
  assert.match(frontend, /function normalizeMovementDate\(value\).*\.slice\(0,10\)/);
  assert.match(frontend, /type='date' data-mvh-edit='tanggal'/);
});
