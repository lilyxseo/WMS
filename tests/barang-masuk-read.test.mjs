import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBarangMasukRequest, mapBarangMasukRow } from '../functions/api/barang-masuk/index.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only' };
const request = query => new Request(`https://app.example/api/barang-masuk${query}`);

test('Barang Masuk adapter returns all business fields without sync metadata', () => {
  assert.deepEqual(mapBarangMasukRow({ tanggal: '2026-08-31', from_location: 'Receiving', to_location: 'A-1', sku: 'SKU-1', nama_barang: 'Produk', qty: 3, status: 'OK', pic: 'Ani', keterangan: 'Baik', no_iseller: 'IS-1', netsuite: '00042', keterangan_lainnya: 'Fragile', lokasi_surat_jalan: 'Rack SJ', stockout: 'No', dokumen: 'https://docs.example/1', source_row_number: 42, synced_at: '2026-08-31T01:00:00Z' }), {
    tanggal: '2026-08-31', from: 'Receiving', to: 'A-1', sku: 'SKU-1', namaBarang: 'Produk', qty: 3, status: 'OK', pic: 'Ani', keterangan: 'Baik', no_iseller: 'IS-1', netsuite: '00042', keterangan_lainnya: 'Fragile', lokasi_surat_jalan: 'Rack SJ', stockout: 'No', dokumen: 'https://docs.example/1', rowNumber: 42,
  });
});

test('endpoint normalizes dates before pagination while applying non-date filters in Supabase', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('inventory_sync_status')) return new Response(JSON.stringify([{ source: 'barang_masuk', status: 'success', last_success_at: '2026-08-31T01:00:00Z' }]), { status: 200 });
    return new Response(JSON.stringify([{ tanggal: '8/31/2026', sku: 'SKU-1', nama_barang: 'Produk', from_location: 'Receiving', to_location: 'A-1', source_row_number: 42 }]), { status: 200, headers: { 'content-range': '0-0/1' } });
  };
  try {
    const response = await handleBarangMasukRequest({ request: request('?page=1&limit=500&sku=SKU-1&q=Produk&from=Receiving&to=A-1&status=OK&startDate=2026-08-01&endDate=2026-08-31'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, 'supabase');
    assert.equal(body.total, 1);
    assert.equal(body.limit, 50);
    assert.equal(body.lastSync, '2026-08-31T01:00:00Z');
    assert.equal(body.data[0].namaBarang, 'Produk');
    const dataUrl = calls[0].url;
    assert.equal(new URL(dataUrl).searchParams.get('select'), 'tanggal,from_location,to_location,sku,nama_barang,qty,status,pic,keterangan,no_iseller,netsuite,keterangan_lainnya,lokasi_surat_jalan,stockout,dokumen,source_row_number');
    assert.match(dataUrl, /offset=0&limit=1000/);
    assert.match(dataUrl, /sku=ilike/);
    assert.match(dataUrl, /or=\(sku\.ilike.*nama_barang\.ilike/);
    assert.match(dataUrl, /from_location=eq\.Receiving/);
    assert.match(dataUrl, /to_location=eq\.A-1/);
    assert.doesNotMatch(dataUrl, /tanggal=(?:gte|lte)/);
    assert.equal(calls.some(call => call.url.includes('googleapis.com')), false);
    assert.equal(calls[0].options.headers.apikey, env.SUPABASE_SECRET_KEY);
    const statusUrl = calls.find(call => call.url.includes('inventory_sync_status')).url;
    assert.equal(new URL(statusUrl).searchParams.get('select'), '*');
  } finally { globalThis.fetch = originalFetch; }
});

test('default page scope includes only Barang Masuk and Movement in rows, totals, search, and sorting', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  const scopedRows = [
    { tanggal: '2026-09-01', sku: 'IN-1', nama_barang: 'Receipt', qty: 2, status: 'Barang Masuk', source_row_number: 1 },
    { tanggal: '2026-09-03', sku: 'MOVE-1', nama_barang: 'Movement target', qty: 5, status: 'Movement', source_row_number: 2 },
  ];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('inventory_sync_status')) return new Response('[]', { status: 200 });
    return new Response(JSON.stringify(scopedRows), { status: 200, headers: { 'content-range': '0-1/2' } });
  };
  try {
    const response = await handleBarangMasukRequest({ request: request('?q=Movement&sort=qty-desc&page=1&limit=1'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.total, 2);
    assert.deepEqual(body.rows.map(row => row.status), ['Movement']);
    assert.deepEqual(body.summary, { totalRows: 2, totalQty: 7, totalSku: 2, latestDate: '2026-09-03', oldestDate: '2026-09-01', invalidDateCount: 0 });
    const dataUrl = new URL(urls[0]);
    assert.equal(dataUrl.searchParams.get('status'), 'in.(Barang Masuk,Movement)');
    assert.match(dataUrl.searchParams.get('or'), /nama_barang\.ilike.*movement/);
  } finally { globalThis.fetch = originalFetch; }
});

test('explicit page status can narrow scope but cannot request an unrelated status', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response('[]', { status: 200, headers: { 'content-range': '*/0' } });
  };
  try {
    await handleBarangMasukRequest({ request: request('?status=Movement&includeSummary=0'), env });
    await handleBarangMasukRequest({ request: request('?status=Unrelated&includeSummary=0'), env });
    assert.equal(new URL(urls[0]).searchParams.get('status'), 'eq.Movement');
    assert.equal(new URL(urls[1]).searchParams.get('status'), 'in.(Barang Masuk,Movement)');
  } finally { globalThis.fetch = originalFetch; }
});

test('full mode batches and explicit Supabase errors never fall back to Google Sheets', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ message: 'database unavailable' }), { status: 503 }); };
  try {
    const response = await handleBarangMasukRequest({ request: request('?mode=full'), env });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(body, {
      success: false,
      reason: 'BARANG_MASUK_FETCH_FAILED',
      code: 'UPSTREAM_QUERY_FAILED',
      message: 'Gagal membaca data Barang Masuk.',
    });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid Supabase success bodies return a controlled JSON error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>upstream failure</html>', { status: 200 });
  try {
    const response = await handleBarangMasukRequest({ request: request(''), env });
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), {
      success: false,
      reason: 'BARANG_MASUK_FETCH_FAILED',
      code: 'UPSTREAM_QUERY_FAILED',
      message: 'Gagal membaca data Barang Masuk.',
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('Supabase failures log diagnostic fields without credentials or request authorization', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: '42703',
    message: 'column inventory_barang_masuk.synced_at does not exist',
    details: 'Missing database column',
    hint: 'Check the select list',
  }), { status: 400 });
  try {
    const response = await handleBarangMasukRequest({
      request: new Request('https://app.example/api/barang-masuk', {
        headers: { Authorization: 'Bearer user-access-token' },
      }),
      env,
    });
    assert.equal(response.status, 500);
    assert.deepEqual(logs, [[
      '[BarangMasukAPI] query-error',
      {
        code: '42703',
        message: 'column inventory_barang_masuk.synced_at does not exist',
        details: 'Missing database column',
        hint: 'Check the select list',
      },
    ]]);
    const serializedLogs = JSON.stringify(logs);
    assert.equal(serializedLogs.includes(env.SUPABASE_SECRET_KEY), false);
    assert.equal(serializedLogs.includes('user-access-token'), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test('mode=full is ignored and cannot bypass bounded pagination', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('inventory_sync_status')) return new Response('[]', { status: 200 });
    const offset = Number(new URL(String(url)).searchParams.get('offset') || 0);
    const length = offset === 0 ? 1000 : 2;
    return new Response(JSON.stringify(Array.from({ length }, (_, index) => ({ sku: `SKU-${offset + index}`, source_row_number: 1002 - offset - index }))), { status: 200, headers: { 'content-range': `${offset}-${offset + length - 1}/1002` } });
  };
  try {
    const response = await handleBarangMasukRequest({ request: request('?mode=full&page=1&limit=25&sort=latest'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.rows.length, 25);
    assert.equal(body.total, 1002);
    assert.equal(body.hasNext, true);
    assert.match(urls[0], /order=source_row_number.desc&offset=0&limit=1000/);
    assert.equal(urls.filter(url => url.includes('inventory_barang_masuk')).length, 2); // two full-set sort batches
  } finally { globalThis.fetch = originalFetch; }
});
