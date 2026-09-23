import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { movementBusinessDates } from '../functions/api/movement/in.js';

const frontend = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

test('Movement derives both sheet date formats from the Jakarta business date', () => {
  assert.deepEqual(movementBusinessDates(new Date('2026-09-15T16:30:00Z')), {
    date: '2026-09-15', sheetDate: '9/15/2026',
  });
  assert.deepEqual(movementBusinessDates(new Date('2026-09-15T17:30:00Z')), {
    date: '2026-09-16', sheetDate: '9/16/2026',
  });
});

test('Movement creation has no editable date or client-supplied transaction date', () => {
  assert.doesNotMatch(frontend, /id='movementTanggal'/);
  assert.doesNotMatch(frontend, /MOVEMENT_STATE\.tanggal/);
  assert.match(frontend, /\(\{from:it\.lokasi/);
});

test('Historical Movement date normalization and editing remain available', () => {
  assert.match(frontend, /function normalizeMovementDate\(value\).*\.slice\(0,10\)/);
  assert.match(frontend, /type='date' data-mvh-edit='tanggal'/);
});

test('Movement backend ignores client date and returns its authoritative business date', async () => {
  const backend = await readFile(new URL('../functions/api/movement/in.js', import.meta.url), 'utf8');
  assert.doesNotMatch(backend, /item\?\.tanggal/);
  assert.match(backend, /BUSINESS_TIME_ZONE/);
  assert.match(backend, /businessDate: tanggal/);
});
