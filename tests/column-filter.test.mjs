import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const helperNames = ['isEmptyFilterValue', 'sanitizeFilterValue', 'getFilterOptionLabel'];
const helperSource = helperNames.map(name => {
  const match = source.match(new RegExp(`function ${name}\\([^\\n]+`));
  assert.ok(match, `${name} must exist`);
  return match[0];
}).join('\n');
const context = { EMPTY_FILTER_VALUE: '__WMS_EMPTY_VALUE__' };
vm.runInNewContext(`${helperSource}; result={isEmptyFilterValue,sanitizeFilterValue,getFilterOptionLabel}`, context);
const { isEmptyFilterValue, sanitizeFilterValue, getFilterOptionLabel } = context.result;

test('(Kosong) only represents nullish or whitespace values', () => {
  for (const value of [null, undefined, '', '   ']) assert.equal(isEmptyFilterValue(value), true);
  for (const value of [0, '0', false, '-', 'null']) assert.equal(isEmptyFilterValue(value), false);
  assert.equal(getFilterOptionLabel(sanitizeFilterValue('   ')), '(Kosong)');
  assert.equal(sanitizeFilterValue(0), '0');
  assert.equal(sanitizeFilterValue(false), 'false');
  assert.equal(sanitizeFilterValue('-'), '-');
});

test('Balikan table derives filters from the complete table schema', () => {
  const baseMatch = source.match(/const BALIKAN_BASE_COLUMNS=([^;]+);/);
  assert.ok(baseMatch);
  const columns = vm.runInNewContext(baseMatch[1]);
  const keys = columns.map(([key]) => key);
  for (const key of ['checked','sheetName','no','sku','namaBarang','qty','rakTujuan','lokasi','stokBulky','stokRetail','status','keterangan']) assert.ok(keys.includes(key), `${key} is filterable`);
  assert.match(source, /getBalikanTableColumns\(\)\.map\(\(\[key,label\]\)=>headerWithFilter/);
  assert.match(source, /dynamic\.filter/);
});

test('column filters combine with AND and search reset preserves column filters and sort', () => {
  assert.match(source, /getBalikanTableColumns\(\)\.some/);
  const resetStart = source.indexOf('function resetBalikanSearch()');
  const reset = source.slice(resetStart, source.indexOf('function exportBalikanFilteredCsv', resetStart));
  assert.match(reset, /balikanSearchKeyword=''/);
  assert.doesNotMatch(reset, /columnFilters:\{\}/);
  assert.doesNotMatch(reset, /sortBy:'default'/);
});

test('inline edits invalidate filter options and re-evaluate active filters', () => {
  const update = source.match(/function updateBalikanLocalRow\([^\n]+/)[0];
  assert.match(update, /lastDataChecksum=checksumBalikanRows/);
  assert.match(update, /filterOptionsVersion=''/);

  const queue = source.match(/function queueBalikanEdit\([^\n]+/)[0];
  assert.match(queue, /setTimeout\(renderBalikanTableWhenIdle,0\)/);
  const idleRender = source.match(/function renderBalikanTableWhenIdle\([^\n]+/)[0];
  assert.match(idleRender, /renderBalikanTable\(true\)/);
});
