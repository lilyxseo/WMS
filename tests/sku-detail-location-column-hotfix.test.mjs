import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const fields = source.match(/const SKU_DETAIL_LOCATION_FIELDS=[^;]+;/)?.[0];
const helper = source.match(/function getSkuDetailPresentationCells\([^\n]+/)?.[0];
assert.ok(fields, 'SKU Detail location field list must exist');
assert.ok(helper, 'SKU Detail presentation helper must exist');

const context = {};
vm.runInNewContext(`${fields}${helper};result=getSkuDetailPresentationCells`, context);
const present = context.result;

test('SKU Detail inventory rows expose one canonical lokasi column', () => {
  const cells = present({ lokasi: 'C14-3', 'lokasi bulky': 'C14-3', sku: '682200002980', 'nama barang': 'Produk' });
  assert.deepEqual(Object.keys(cells), ['lokasi', 'sku', 'nama barang']);
  assert.equal(cells.lokasi, 'C14-3');
  assert.equal('lokasi bulky' in cells, false);
});

test('canonical lokasi wins and is never concatenated with bulky location', () => {
  const cells = present({ lokasi: 'D02-2', lokasi_bulky: 'OTHER', lokasiBulky: 'THIRD', sku: '682200002980' });
  assert.equal(cells.lokasi, 'D02-2');
  assert.doesNotMatch(cells.lokasi, /OTHER|THIRD|\|/);
  assert.deepEqual(Object.keys(cells), ['lokasi', 'sku']);
});

test('empty canonical lokasi falls back across supported bulky field names', () => {
  assert.equal(present({ lokasi: '', lokasi_bulky: 'C10-4' }).lokasi, 'C10-4');
  assert.equal(present({ lokasi: null, lokasiBulky: 'MASIH DI INBOUND' }).lokasi, 'MASIH DI INBOUND');
  assert.equal(present({ lokasi: '  ', 'lokasi bulky': 'REJECT STORE' }).lokasi, 'REJECT STORE');
});

test('only Kartu Stock, RPL, and BULKY use the SKU Detail location projection', () => {
  const render = source.slice(source.indexOf('function renderSkuDetailTable'), source.indexOf('function renderTable'));
  assert.match(render, /INVENTORY_PRELOAD_SHEETS\.includes\(sheet\)\?getSkuDetailPresentationCells:null/);
  assert.match(source, /renderSkuDetailTable\(sheet,rows\)/);
});
