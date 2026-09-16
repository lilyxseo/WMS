import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionPageCache, transactionPageKey, transactionSummaryKey } from '../assets/js/transaction-page-cache.js';

test('transaction cache keys isolate source, paging, query, filters and sort', () => {
  const base = { source: 'barang_masuk', page: 1, limit: 25, query: '', filters: { status: ['Barang Masuk'] }, sort: 'latest' };
  assert.notEqual(transactionPageKey(base), transactionPageKey({ ...base, source: 'barang_keluar' }));
  assert.notEqual(transactionPageKey(base), transactionPageKey({ ...base, page: 2 }));
  assert.notEqual(transactionPageKey(base), transactionPageKey({ ...base, query: 'sku' }));
  assert.equal(transactionSummaryKey(base), transactionSummaryKey({ ...base, page: 9, limit: 50, sort: 'oldest' }));
});

test('Barang Masuk keys use a bumped namespace without changing Barang Keluar', () => {
  assert.match(transactionPageKey({ source: 'barang_masuk', page: 1, limit: 25 }), /^barang_masuk@v2\|/);
  assert.match(transactionPageKey({ source: 'barang_keluar', page: 1, limit: 25 }), /^barang_keluar@v1\|/);
});

test('transaction page cache is an eight-page LRU per source', () => {
  const cache = new TransactionPageCache(8);
  for (let page = 1; page <= 8; page++) cache.set('barang_masuk', `page-${page}`, { rows: [{ page }], total: 20 });
  cache.get('barang_masuk', 'page-1');
  cache.set('barang_masuk', 'page-9', { rows: [{ page: 9 }], total: 20 });
  assert.equal(cache.get('barang_masuk', 'page-2'), null);
  assert.equal(cache.get('barang_masuk', 'page-1').rows[0].page, 1);
  assert.equal(cache.pages.barang_masuk.size, 8);
  assert.equal(cache.pages.barang_keluar.size, 0);
});

test('freshness is 45 seconds and source invalidation stays isolated', () => {
  const cache = new TransactionPageCache();
  cache.set('barang_masuk', 'in', { rows: [], fetchedAt: 1_000 });
  cache.set('barang_keluar', 'out', { rows: [], fetchedAt: 1_000 });
  cache.setSummary('barang_masuk|q=', { totalRows: 1 });
  assert.equal(cache.isFresh(cache.get('barang_masuk', 'in'), 45_999), true);
  assert.equal(cache.isFresh(cache.get('barang_masuk', 'in'), 46_001), false);
  cache.clearSource('barang_masuk');
  assert.equal(cache.get('barang_masuk', 'in'), null);
  assert.ok(cache.get('barang_keluar', 'out'));
});
