import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBarangKeluarRequest, mapBarangKeluarRow } from '../functions/api/barang-keluar/index.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only' };
const request = query => new Request(`https://app.example/api/barang-keluar${query}`);

test('Barang Keluar adapter exposes all business fields without sync metadata', () => {
  assert.deepEqual(mapBarangKeluarRow({ tanggal: '2026-08-31', from_location: 'A-1', to_location: 'Store', sku: 'SKU-1', nama_barang: 'Produk', qty: 3, status: 'OK', pic: 'Ani', keterangan: 'Baik', no_iseller: 'IS-1', netsuite: '42', keterangan_lainnya: 'Fragile', status_lanjutan: 'Closed', lokasi_surat_jalan: 'Rack', no_iseller_awal: 'IS-0', dokumen: 'https://docs.example/1', source_row_number: 42, synced_at: 'hidden' }), {
    tanggal: '2026-08-31', from: 'A-1', to: 'Store', sku: 'SKU-1', namaBarang: 'Produk', qty: 3, status: 'OK', pic: 'Ani', keterangan: 'Baik', no_iseller: 'IS-1', netsuite: '42', keterangan_lainnya: 'Fragile', status_lanjutan: 'Closed', lokasi_surat_jalan: 'Rack', no_iseller_awal: 'IS-0', dokumen: 'https://docs.example/1', rowNumber: 42,
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
    assert.equal(body.limit, 50);
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

test('default pagination scans matching rows in bounded server batches before returning 50', async () => {
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
    assert.match(urls[0], /order=source_row_number.desc/);
  } finally { globalThis.fetch = originalFetch; }
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
    const body = await (await handleBarangKeluarRequest({ request: request('?mode=full&page=1&limit=25&sort=latest'), env })).json();
    assert.equal(body.rows.length, 25);
    assert.equal(body.total, 1002);
    assert.equal(body.hasNext, true);
    assert.match(urls[0], /order=source_row_number.desc&offset=0&limit=1000/);
    assert.equal(urls.filter(url => url.includes('inventory_barang_keluar')).length, 2); // two full-set sort batches
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
    assert.deepEqual(await response.json(), { success: false, reason: 'BARANG_KELUAR_FETCH_FAILED', code: 'UPSTREAM_QUERY_FAILED', message: 'Gagal membaca data Barang Keluar.' });
    assert.equal(urls.length, 1);
    assert.equal(urls.some(url => url.includes('googleapis.com')), false);
  } finally { globalThis.fetch = originalFetch; }
});
