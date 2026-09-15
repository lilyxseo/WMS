import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBarangKeluarRequest, mapBarangKeluarRow } from '../functions/api/barang-keluar/index.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only' };
const request = query => new Request(`https://app.example/api/barang-keluar${query}`);

test('Barang Keluar adapter preserves the legacy frontend fields', () => {
  assert.deepEqual(mapBarangKeluarRow({ tanggal: '2026-08-31', from_location: 'A-1', to_location: 'Store', sku: 'SKU-1', nama_barang: 'Produk', qty: 3, status: 'OK', pic: 'Ani', keterangan: 'Baik', source_row_number: 42 }), {
    tanggal: '2026-08-31', from: 'A-1', from_location: 'A-1', to: 'Store', to_location: 'Store', sku: 'SKU-1', namaBarang: 'Produk', nama_barang: 'Produk', qty: 3, status: 'OK', pic: 'Ani', keterangan: 'Baik', rowNumber: 42, source_row_number: 42, synced_at: null,
  });
});

test('endpoint normalizes dates before pagination and applies non-date filters in Supabase', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('inventory_sync_status')) return new Response(JSON.stringify([{ source: 'barang_keluar', status: 'success', last_success_at: '2026-08-31T01:00:00Z' }]), { status: 200 });
    return new Response(JSON.stringify([{ tanggal: '8/31/2026', sku: 'SKU-1', nama_barang: 'Produk', source_row_number: 42 }]), { status: 200, headers: { 'content-range': '0-0/1' } });
  };
  try {
    const response = await handleBarangKeluarRequest({ request: request('?page=2&limit=500&sku=SKU-1&q=Produk&status=OK&startDate=2026-08-01&endDate=2026-08-31'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, 'supabase');
    assert.equal(body.table, 'public.inventory_barang_keluar');
    assert.equal(body.total, 1);
    assert.equal(body.limit, 100);
    assert.equal(body.lastSync, '2026-08-31T01:00:00Z');
    assert.deepEqual(body.syncStatus, { source: 'barang_keluar', status: 'success', last_success_at: '2026-08-31T01:00:00Z' });
    const dataUrl = calls[0].url;
    assert.match(dataUrl, /offset=0&limit=1000/);
    assert.match(dataUrl, /sku=ilike/);
    assert.match(dataUrl, /or=\(sku\.ilike.*nama_barang\.ilike/);
    assert.match(dataUrl, /status=eq\.OK/);
    assert.doesNotMatch(dataUrl, /tanggal=(?:gte|lte)/);
    assert.equal(calls.some(call => call.url.includes('googleapis.com')), false);
    assert.equal(calls[0].options.headers.apikey, env.SUPABASE_SECRET_KEY);
    assert.equal(new URL(calls.find(call => call.url.includes('inventory_sync_status')).url).searchParams.get('source'), 'eq.barang_keluar');
  } finally { globalThis.fetch = originalFetch; }
});

test('default pagination is 50 rows', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response('[]', { status: 200, headers: { 'content-range': '*/0' } });
  };
  try {
    const body = await (await handleBarangKeluarRequest({ request: request(''), env })).json();
    assert.equal(body.limit, 50);
    assert.match(urls[0], /offset=0&limit=1000/);
  } finally { globalThis.fetch = originalFetch; }
});

test('full mode batches all rows for frontend compatibility', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('inventory_sync_status')) return new Response('[]', { status: 200 });
    const offset = Number(new URL(String(url)).searchParams.get('offset'));
    const size = offset === 0 ? 1000 : 2;
    return new Response(JSON.stringify(Array.from({ length: size }, (_, index) => ({ sku: `SKU-${offset + index}` }))), { status: 200, headers: { 'content-range': `${offset}-${offset + size - 1}/1002` } });
  };
  try {
    const body = await (await handleBarangKeluarRequest({ request: request('?mode=full'), env })).json();
    assert.equal(body.data.length, 1002);
    assert.equal(urls.filter(url => url.includes('inventory_barang_keluar')).length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('Supabase failure returns controlled JSON and never falls back to Sheets', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify({ message: 'database unavailable' }), { status: 503 });
  };
  try {
    const response = await handleBarangKeluarRequest({ request: request(''), env });
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { success: false, reason: 'BARANG_KELUAR_FETCH_FAILED', message: 'Gagal membaca data Barang Keluar.' });
    assert.equal(urls.length, 1);
    assert.equal(urls.some(url => url.includes('googleapis.com')), false);
  } finally { globalThis.fetch = originalFetch; }
});
