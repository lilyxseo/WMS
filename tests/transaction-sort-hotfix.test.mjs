import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const masuk = await readFile(new URL('../functions/api/barang-masuk/index.js', import.meta.url), 'utf8');
const keluar = await readFile(new URL('../functions/api/barang-keluar/index.js', import.meta.url), 'utf8');

test('both dropdowns use backend sort names and retain source-specific state', () => {
  for (const value of ['latest', 'oldest', 'sku-asc', 'name-asc', 'qty-desc', 'qty-asc']) {
    assert.match(main, new RegExp(`option value='${value}'`));
  }
  assert.match(main, /st\.sort=t\.value\|\|"latest";st\.page=1;loadTransactionTablePage\(m,\{page:1\}\)/);
  assert.match(main, /const sort=st\.sort\|\|'latest'/);
  assert.doesNotMatch(main.slice(main.indexOf('function getMovementFilteredRows'), main.indexOf('function rerenderTableByMode')), /sortTableRows\(/);
});

test('cache, next page and prefetch carry the selected sort with stale protection', () => {
  const loader = main.slice(main.indexOf('async function prefetchTransactionPage'), main.indexOf('function normalizeMovementRows'));
  assert.match(loader, /transactionPageKey\(\{source,page,limit,query,filters,sort\}\)/);
  assert.match(loader, /URLSearchParams\(\{page:String\(page\),limit:String\(limit\),sort,includeSummary:'0'\}\)/);
  assert.match(loader, /requestId!==st\.requestId\|\|controller\.signal\.aborted/);
  assert.match(main, /return loadTransactionTablePage\(mode,\{page\}\)/);
  assert.doesNotMatch(loader, /mode=full/);
});

test('both endpoints pass their allowlisted sort into full-set server ordering', () => {
  for (const source of [masuk, keluar]) {
    assert.match(source, /const sort = transactionSort\(url\.searchParams\.get\('sort'\)\)/);
    assert.match(source, /filterQuery, startDate, endDate, page, limit, sort: sort\.name/);
  }
  assert.match(masuk, /PAGE_STATUSES = Object\.freeze\(\['Barang Masuk', 'Movement'\]\)/);
  assert.match(masuk, /status=in\.\(\$\{PAGE_STATUSES\.map\(encodeURIComponent\)\.join\(','\)\}\)/);
});
