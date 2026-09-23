import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function resetBalikanSearch()');
const end = source.indexOf('\nfunction exportBalikanFilteredCsv', start);
const reset = source.slice(start, end);

test('Balikan Reset clears only search-related state and starts search results at page one', () => {
  assert.match(reset, /balikanSearchKeyword=''/);
  assert.match(reset, /exactScanSku:''/);
  assert.match(reset, /highlightRowNumber:null/);
  assert.match(reset, /highlightSheetName:''/);
  assert.match(reset, /selectedSkuRowNumber:null/);
  assert.match(reset, /ensureBalikanFilterState\(\)\.page=1/);
  assert.match(reset, /balikanSearchInput\.value=''/);
});

test('Balikan Reset renders unfiltered cached rows without navigation or a data reload', () => {
  assert.match(reset, /renderBalikanTable\(false\)/);
  assert.doesNotMatch(reset, /location\.(reload|replace|assign)/);
  assert.doesNotMatch(reset, /load(?:All)?Balikan/);
  assert.doesNotMatch(reset, /fetch\(/);
});

test('Balikan Reset preserves the active sheet, sort, column filters, and selector values', () => {
  assert.doesNotMatch(reset, /currentTripSheet\s*=/);
  assert.doesNotMatch(reset, /sortBy\s*:/);
  assert.doesNotMatch(reset, /columnFilters\s*:/);
  assert.doesNotMatch(reset, /balikanSheetSelect\.value\s*=/);
  assert.doesNotMatch(reset, /balikanSortSelect\.value\s*=/);
  assert.match(source, /btnResetBalikanFilter\?\.addEventListener\("click",resetBalikanSearch\)/);
});
