import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHEET_BARANG_KELUAR,
  SHEET_BARANG_MASUK,
  barangDataRange,
} from '../functions/api/_barang-ops.js';

test('range Barang Masuk tidak dibatasi sampai baris 20.000', () => {
  assert.equal(barangDataRange(SHEET_BARANG_MASUK), 'Barang Masuk!A2:O');
});

test('range Barang Keluar tidak dibatasi sampai baris 20.000', () => {
  assert.equal(barangDataRange(SHEET_BARANG_KELUAR), 'Barang KeIuar!A2:P');
});
