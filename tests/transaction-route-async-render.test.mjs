import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

function bodyBetween(start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test('transaction routes expose their shell before starting an async read', () => {
  const showPage = bodyBetween('function showPage(page)', 'function pageTitleFromPath(path)');
  const transactionBranch = showPage.slice(showPage.indexOf('if(page==="barang-masuk"||page==="barang-keluar")'));
  assert.ok(transactionBranch.indexOf('setMainContentLoading(false)') < transactionBranch.indexOf('loadDetailPageData(page)'));
  assert.doesNotMatch(transactionBranch.slice(0, transactionBranch.indexOf('return;}')), /await /);
});

test('transaction reads render locally while pending and protect against stale responses', () => {
  const loader = bodyBetween('async function loadTransactionTablePage', 'function invalidateInactiveTransactionRequests');
  assert.ok(loader.indexOf('st.loading=true') < loader.indexOf('await fetchJsonSafe'));
  assert.ok(loader.indexOf('renderDataTablePage') < loader.indexOf('await fetchJsonSafe'));
  assert.match(loader, /new AbortController\(\)/);
  assert.match(loader, /\{signal:controller\.signal\}/);
  assert.match(loader, /requestId!==st\.requestId\|\|controller\.signal\.aborted/);
  assert.doesNotMatch(loader, /mode=full/);
});

test('transaction loading and errors stay inside the table container', () => {
  const renderer = bodyBetween('function renderTransactionLoadingState', 'function renderDataTablePage');
  assert.match(renderer, /Memuat data\.\.\./);
  assert.match(renderer, /mv-skeleton-row/);
  assert.match(renderer, /Gagal memuat data/);
  assert.match(renderer, /data-mv-action='retry'/);
  assert.match(renderer, /mv-pagination/);
});
