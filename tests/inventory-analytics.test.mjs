import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDateKey, computeInventorySummary, loadInventoryAnalyticsRows, loadInventoryCounts, transactionDateRepresentations } from '../functions/api/_inventory-analytics.js';

test('inventory summary preserves dashboard, accuracy, warning and minus semantics', () => {
  const rows = {
    kartuStok: [
      { sku: 'A', stok_akhir: -3, pengeluaran: 2 },
      { sku: 'B', stok_akhir: 5, pengeluaran: 0 },
    ],
    rpl: [
      { sku: 'A', nama_barang: 'Alpha', lokasi_bulky: 'AA-1-1-A', stok_akhir: 10, netsuite: 10 },
      { sku: 'B', nama_barang: 'Beta', lokasi_bulky: 'AA-1-1-B', stok_akhir: 12, netsuite: 10 },
    ],
    bulky: [
      { sku: 'A', nama_barang: 'Alpha', lokasi_bulky: 'A01-1', selisih: 0 },
      { sku: 'B', nama_barang: 'Beta changed', lokasi_bulky: 'A01-1', selisih: 0 },
    ],
    barangMasuk: [
      { sku: 'A', status: 'Barang Masuk', tanggal: '2026-09-02' },
      { sku: 'A', status: 'Movement', tanggal: '2026-09-02' },
      { sku: '', status: 'Barang Masuk', tanggal: '2026-09-02' },
    ],
    barangKeluar: [{ sku: 'B', keterangan: 'Pengeluaran', tanggal: '2026-09-02' }],
  };

  const summary = computeInventorySummary(rows, new Date('2026-09-02T12:00:00Z'));
  assert.equal(summary.totalSku, 2);
  assert.equal(summary.barangMasuk, 1);
  assert.equal(summary.barangKeluar, 1);
  assert.equal(summary.totalMovement, 1);
  assert.equal(summary.minusStock, 1);
  assert.equal(summary.minusQuantity, 3);
  assert.equal(summary.accuracy, 50);
  assert.equal(summary.duplicateSku, 0);
  assert.equal(summary.missingSku, 1);
  assert.equal(summary.locationMismatch, 0);
  assert.equal(summary.deadStock, 1);
  assert.equal(summary.reconciliationDifference, 2);
});

test('accuracy uses RPL Supabase NETSUITE and excludes NULL references', () => {
  const summary = computeInventorySummary({
    kartuStok: [], bulky: [{ sku: 'A', stok_akhir: 999, netsuite: 999 }], barangMasuk: [], barangKeluar: [],
    rpl: [
      { sku: 'A', stok_akhir: 12, netsuite: 10 },
      { sku: 'B', stok_akhir: 7, netsuite: 7 },
      { sku: 'C', stok_akhir: 5, netsuite: null },
    ],
  });
  assert.equal(summary.accuracy, 50);
  assert.equal(summary.accurateSku, 1);
  assert.equal(summary.inaccurateSku, 1);
  assert.equal(summary.missingAccuracyReference, 1);
  assert.equal(summary.reconciliationDifference, 2);
});

test('Barang Masuk today uses the Jakarta business date and counts supported text dates by row', async () => {
  assert.equal(businessDateKey(new Date('2026-09-15T17:30:00Z')), '2026-09-16');
  assert.deepEqual(transactionDateRepresentations('2026-09-16'), ['2026-09-16', '9/16/2026', '09/16/2026']);

  const sample = [
    { tanggal: '2026-09-15', status: 'Barang Masuk' },
    { tanggal: '2026-09-16', status: 'Barang Masuk' },
    { tanggal: '9/16/2026', status: 'Barang Masuk' },
    { tanggal: '2026-09-16', status: 'Movement' },
  ];
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    requests.push(parsed);
    const status = parsed.searchParams.get('status')?.replace(/^eq\./, '').replace(/^ilike\./, '');
    const expression = parsed.searchParams.get('or') || '';
    const dates = [...expression.matchAll(/tanggal\.eq\.([^,)]+)/g)].map(match => decodeURIComponent(match[1]));
    const matched = sample.filter(row => (!status || row.status.toLowerCase() === status.toLowerCase()) && (!dates.length || dates.includes(row.tanggal)));
    return new Response(JSON.stringify(matched.slice(0, 1)), { status: 200, headers: { 'content-range': `0-0/${matched.length}` } });
  };
  try {
    const counts = await loadInventoryCounts({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' }, new Date('2026-09-15T17:30:00Z'));
    assert.equal(counts.businessDate, '2026-09-16');
    assert.equal(counts.barangMasukHariIni, 2);
    assert.equal(counts.totalMovementHariIni, 1);
    const todayRequest = requests.find(url => url.searchParams.get('status') === 'eq.Barang Masuk' && url.searchParams.has('or'));
    assert.ok(todayRequest);
    assert.equal(todayRequest.searchParams.get('select'), 'sku');
    assert.equal(todayRequest.searchParams.get('limit'), '1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dashboard bootstrap uses summary API without full mode', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8'));
  const summaryBootstrap = source.slice(source.indexOf('async function initAppData()'), source.indexOf('await hydrateModuleCachesFromDb()', source.indexOf('async function initAppData()')));
  assert.match(summaryBootstrap, /loadDashboardPayload\(\)/);
  assert.match(source, /fetchJsonSafe\('\/api\/dashboard-summary'/);
  assert.doesNotMatch(summaryBootstrap, /mode=full/);
  assert.match(source, /!\["dashboard","search"\]\.includes\(page\)&&!LOADED_DETAIL_PAGES\.has\(page\)/);
});

test('analytics retries optional-column mismatches and tolerates one unavailable source', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    if (String(url).includes('inventory_rpl') && String(url).includes('select=sku,')) {
      return new Response(JSON.stringify({ code: '42703', message: 'column does not exist' }), { status: 400 });
    }
    if (String(url).includes('inventory_bulky')) {
      return new Response(JSON.stringify({ message: 'temporary failure' }), { status: 503 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };
  try {
    const result = await loadInventoryAnalyticsRows({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' });
    assert.deepEqual(result.rows.rpl, []);
    assert.deepEqual(result.rows.bulky, []);
    assert.deepEqual(result.unavailableSources, undefined);
    assert.deepEqual(result.failures.map(item => item.source), ['inventory_bulky']);
    assert.ok(requests.some(url => url.includes('inventory_rpl?select=*')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
