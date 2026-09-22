export const TRANSACTION_PAGE_CACHE_TTL_MS = 45_000;
export const TRANSACTION_PAGE_CACHE_LIMIT = 8;
// Bump each source namespace when its API row schema changes so cached pages
// never hide newly deployed business columns.
export const TRANSACTION_CACHE_VERSIONS = Object.freeze({ barang_masuk: 3, barang_keluar: 2 });

function versionedSource(source) {
  return `${source}@v${TRANSACTION_CACHE_VERSIONS[source] || 1}`;
}

function stableObject(value = {}) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

export function transactionPageKey({ source, page, limit, query = '', filters = {}, sort = 'latest' }) {
  return `${versionedSource(source)}|page=${page}|limit=${limit}|q=${encodeURIComponent(query)}|filters=${encodeURIComponent(JSON.stringify(stableObject(filters)))}|sort=${sort}`;
}

export function transactionSummaryKey({ source, query = '', filters = {} }) {
  return `${versionedSource(source)}|q=${encodeURIComponent(query)}|filters=${encodeURIComponent(JSON.stringify(stableObject(filters)))}`;
}

export class TransactionPageCache {
  constructor(maxPagesPerSource = TRANSACTION_PAGE_CACHE_LIMIT) {
    this.maxPagesPerSource = maxPagesPerSource;
    this.pages = { barang_masuk: new Map(), barang_keluar: new Map() };
    this.summaries = new Map();
  }

  get(source, key) {
    const bucket = this.pages[source];
    const value = bucket?.get(key);
    if (!value) return null;
    bucket.delete(key);
    bucket.set(key, value);
    return value;
  }

  set(source, key, value) {
    const bucket = this.pages[source];
    if (!bucket) throw new TypeError(`Unknown transaction source: ${source}`);
    bucket.delete(key);
    bucket.set(key, { ...value, fetchedAt: value.fetchedAt || Date.now() });
    while (bucket.size > this.maxPagesPerSource) bucket.delete(bucket.keys().next().value);
  }

  setSummary(key, summary) { this.summaries.set(key, { summary, fetchedAt: Date.now() }); }
  getSummary(key) { return this.summaries.get(key) || null; }
  isFresh(entry, now = Date.now(), sourceVersion) {
    return Boolean(entry && !entry.stale
      && now - entry.fetchedAt < TRANSACTION_PAGE_CACHE_TTL_MS
      && (sourceVersion == null || entry.sourceVersion === sourceVersion));
  }
  markSourceStale(source) {
    for (const entry of this.pages[source]?.values() || []) entry.stale = true;
  }
  clearSource(source) {
    this.pages[source]?.clear();
    for (const key of this.summaries.keys()) {
      if (key.startsWith(`${versionedSource(source)}|`) || key.startsWith(`${source}|`)) this.summaries.delete(key);
    }
  }
}
