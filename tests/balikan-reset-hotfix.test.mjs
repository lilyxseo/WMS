import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function resetBalikanFilter()');
const end = source.indexOf('\nfunction exportBalikanFilteredCsv', start);
const reset = source.slice(start, end);

test('Balikan Reset synchronizes every filter, selection, and input with defaults', () => {
  assert.match(reset, /balikanSearchKeyword=''/);
  assert.match(reset, /currentTripSheet=''/);
  assert.match(reset, /sortBy:'default'/);
  assert.match(reset, /exactScanSku:''/);
  assert.match(reset, /selectedSkuRowNumber:null/);
  assert.match(reset, /highlightRowNumber:null/);
  assert.match(reset, /page:1,pageSize:50,openFilterCol:'',columnFilters:\{\}/);
  assert.match(reset, /balikanSearchInput\.value=''/);
  assert.match(reset, /balikanSheetSelect\.value=''/);
  assert.match(reset, /balikanSortSelect\.value='default'/);
});

test('Balikan Reset performs one forced default reload without browser navigation', () => {
  assert.match(reset, /if\(BALIKAN_STATE\.resetPromise\)return BALIKAN_STATE\.resetPromise/);
  assert.match(reset, /loadAllBalikanTripRows\(\{background:true,force:true,throwOnError:true\}\)/);
  assert.doesNotMatch(reset, /location\.(reload|replace|assign)/);
  assert.match(reset, /scrollTop=0/);
  assert.match(reset, /scrollLeft=0/);
});

test('Balikan Reset keeps the shell visible and restores controls after reload errors', () => {
  assert.match(reset, /balikanTable\.innerHTML='<div class="state">/);
  assert.match(reset, /data-balikan-reset-retry/);
  assert.match(reset, /btnResetBalikanFilter\.disabled=false/);
});
