import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const aliases = source.match(/const TRANSACTION_LOCATION_ALIASES=[^;]+;/)?.[0];
const helper = source.match(/function getTransactionPresentationCells\([^\n]+/)?.[0];
assert.ok(aliases, 'transaction location alias map must exist');
assert.ok(helper, 'transaction presentation helper must exist');

const context = {};
vm.runInNewContext(`${aliases}${helper};result=getTransactionPresentationCells`, context);
const getTransactionPresentationCells = context.result;

test('Barang Masuk and Barang Keluar present FROM and TO only once', () => {
  for (const row of [
    { tanggal: '2026-09-15', from: 'D10-1', from_location: 'D10-1', to: 'D15-1', to_location: 'D15-1', sku: 'IN-1' },
    { tanggal: '2026-09-15', from: 'D15-1', from_location: 'D15-1', to: 'STORE', to_location: 'STORE', sku: 'OUT-1' },
  ]) {
    const cells = getTransactionPresentationCells(row);
    assert.deepEqual(Object.keys(cells), ['tanggal', 'from', 'to', 'sku']);
    assert.equal(cells.from, row.from_location);
    assert.equal(cells.to, row.to_location);
  }
});

test('a location alias is retained when it contains unique information', () => {
  const cells = getTransactionPresentationCells({ from: 'D10-1', from_location: 'RECEIVING', to: 'D15-1', to_location: 'D15-1' });
  assert.equal(cells.from, 'D10-1');
  assert.equal(cells.from_location, 'RECEIVING');
  assert.equal(cells.to, 'D15-1');
  assert.equal('to_location' in cells, false);
});

test('table export uses the same deduplicated columns and cell values as presentation', () => {
  assert.match(source, /const rawCells=getTransactionPresentationCells\(r\)/);
  assert.match(source, /const cols=st\.columns\|\|\[\];const lines=\[cols\.join\(","\),\.\.\.st\.filtered\.map\(r=>cols\.map\(c=>/);
});

test('Movement session and history already use a single From and To column', () => {
  const movement = source.slice(source.indexOf('function renderMovementSession()'), source.indexOf('function renderMovementPage()'));
  const history = source.slice(source.indexOf('function renderMovementPage()'), source.indexOf('function bindMovementEvents()'));
  assert.match(movement, /<th>From<\/th><th>To<\/th>/);
  assert.match(history, /<th>From<\/th><th>To<\/th>/);
  assert.doesNotMatch(`${movement}${history}`, /FROM_LOCATION|TO_LOCATION|from_location|to_location/);
});
