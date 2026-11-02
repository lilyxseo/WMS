import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const names = ['isEmptyArchiveValue', 'archiveFilterIsActive', 'matchesArchiveColumnFilter'];
const helperSource = names.map(name => {
  const match = source.match(new RegExp(`function ${name}\\([^\\n]+`));
  assert.ok(match, `${name} must exist`);
  return match[0];
}).join('\n');
const context = {};
vm.runInNewContext(`${helperSource}; result={${names.join(',')}}`, context);
const { isEmptyArchiveValue, matchesArchiveColumnFilter } = context.result;

test('Arsip empty filter preserves numeric zero', () => {
  for (const value of [null, undefined, '', '   ']) assert.equal(isEmptyArchiveValue(value), true);
  for (const value of [0, '0', false, '-']) assert.equal(isEmptyArchiveValue(value), false);
  assert.equal(matchesArchiveColumnFilter(0, { mode: 'exact', value: '0' }), true);
  assert.equal(matchesArchiveColumnFilter(0, { mode: 'empty' }), false);
});

test('Arsip contains filters are trimmed, case insensitive, and preserve hyphens', () => {
  assert.equal(matchesArchiveColumnFilter('GN-210047', { mode: 'contains', value: ' gn- ' }), true);
  assert.equal(matchesArchiveColumnFilter('GOTO PORTABLE MINI FAN CLIP WHITE', { mode: 'contains', value: 'portable mini' }), true);
  assert.equal(matchesArchiveColumnFilter('BB-7-2-D,F20-2', { mode: 'contains', value: 'f20-2' }), true);
});

test('Arsip value filters allow multiple selected values including empty', () => {
  const filter = { mode: 'values', values: ['AOI-1', 'AOI-2', '0'], includeEmpty: true };
  assert.equal(matchesArchiveColumnFilter('AOI-1', filter), true);
  assert.equal(matchesArchiveColumnFilter('AOI-2', filter), true);
  assert.equal(matchesArchiveColumnFilter('AOI-3', filter), false);
  assert.equal(matchesArchiveColumnFilter('', filter), true);
  assert.equal(matchesArchiveColumnFilter(0, filter), true);
  assert.match(source, /data-table-filters='archive'/);
  assert.match(source, /updateArchiveValueFilter/);
});

test('Arsip filtering and pagination are client-side and dynamic', () => {
  assert.match(source, /Object\.entries\(filters\)\.every/);
  assert.match(source, /columns\.map\(c=>renderArchiveFilterHeader/);
  assert.match(source, /\[25,50,100,200\]/);
  assert.match(source, /ARCHIVE_STATE\.pageSize=Number\(e\.target\.value\)\|\|25;ARCHIVE_STATE\.page=1;renderArchiveTableOnly\(\)/);
  assert.doesNotMatch(source.match(/if\(e\.target\?\.matches\("\[data-archive-page-size\]"\)\)[^}]+/)[0], /fetch/);
});
