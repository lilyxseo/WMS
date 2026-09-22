import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBulkyRequest, mapBulkyRow } from '../functions/api/bulky/index.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only' };
const request = query => new Request(`https://app.example/api/bulky${query}`);

test('BULKY adapter returns every business field in UI order without metadata or duplicate location', () => {
  const mapped = mapBulkyRow({ lokasi_bulky: 'A01-1', sku: 'SKU-1', nama_barang: 'Produk', stok_awal: 2, internal_stock_transfer: 3, replenishment: 4, pengeluaran: 1, stok_akhir: 8, iseller: 8, netsuite: 7, selisih: 1, pendingan_it: 2, source_row_number: 9, synced_at: '2026-08-31T00:00:00Z' });
  assert.deepEqual(mapped, {
    lokasi: 'A01-1', sku: 'SKU-1', 'nama barang': 'Produk', 'stok awal': 2, 'internal stock transfer': 3, replenishment: 4, pengeluaran: 1, 'stok akhir': 8, iseller: 8, netsuite: 7, selisih: 1, 'pendingan it': 2,
  });
  assert.deepEqual(Object.keys(mapped).map(key => key.toUpperCase()), ['LOKASI', 'SKU', 'NAMA BARANG', 'STOK AWAL', 'INTERNAL STOCK TRANSFER', 'REPLENISHMENT', 'PENGELUARAN', 'STOK AKHIR', 'ISELLER', 'NETSUITE', 'SELISIH', 'PENDINGAN IT']);
});

test('GET /api/bulky paginates and applies SKU, name/SKU search, and location filters', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('inventory_sync_status')) return new Response(JSON.stringify([{ source: 'bulky', status: 'success', last_success_at: '2026-08-31T01:00:00Z' }]), { status: 200 });
    return new Response(JSON.stringify([{ lokasi_bulky: 'A01-1', sku: 'SKU-1', nama_barang: 'Produk', stok_akhir: 8, iseller: 8, netsuite: 7, selisih: 1, pendingan_it: 2 }]), { status: 200, headers: { 'content-range': '100-100/205' } });
  };
  try {
    const response = await handleBulkyRequest({ request: request('?page=2&limit=500&sku=SKU-1&q=Produk&lokasi=A01-1'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.total, 205);
    assert.equal(body.limit, 100);
    assert.equal(body.lastSync, '2026-08-31T01:00:00Z');
    assert.equal(body.syncStatus.source, 'bulky');
    const statusUrl = calls.find(call => call.url.includes('inventory_sync_status')).url;
    assert.equal(new URL(statusUrl).searchParams.get('select'), '*');
    assert.doesNotMatch(statusUrl, /last_attempt_at/);
    assert.equal(body.data[0]['nama barang'], 'Produk');
    assert.deepEqual([body.data[0].iseller, body.data[0].netsuite, body.data[0].selisih, body.data[0]['pendingan it']], [8, 7, 1, 2]);
    assert.doesNotMatch(new URL(calls[0].url).searchParams.get('select'), /source_row_number|synced_at|source_hash|source_row_key/);
    assert.match(calls[0].url, /offset=100&limit=100/);
    assert.match(calls[0].url, /sku=ilike/);
    assert.match(calls[0].url, /or=%28sku\.ilike|or=\(sku\.ilike/);
    assert.match(calls[0].url, /nama_barang\.ilike/);
    assert.match(calls[0].url, /lokasi_bulky\.ilike/);
    assert.equal(calls[0].options.headers.apikey, env.SUPABASE_SECRET_KEY);
    assert.equal(calls.some(call => call.url.includes('googleapis.com')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('BULKY defaults to 50 rows and has no Google Sheets fallback', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify({ message: 'database unavailable' }), { status: 503 });
  };
  try {
    const response = await handleBulkyRequest({ request: request(''), env });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.reason, 'BULKY_FETCH_FAILED');
    assert.match(body.message, /Supabase.*database unavailable/);
    assert.match(urls[0], /offset=0&limit=50/);
    assert.equal(urls.some(url => url.includes('googleapis.com')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('BULKY full mode batches all rows for the unchanged UI contract', async () => {
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
    const response = await handleBulkyRequest({ request: request('?mode=full'), env });
    const body = await response.json();
    assert.equal(body.data.length, 1002);
    assert.equal(body.total, 1002);
    assert.equal(urls.filter(url => url.includes('inventory_bulky')).length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('frontend routes BULKY exclusively through its backend full-mode endpoint', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../assets/js/api.js', import.meta.url), 'utf8'));
  assert.match(source, /'BULKY': '\/api\/bulky\?mode=full'/);
  assert.match(source, /window\.__bulkyLastSync = json\.lastSync/);
});
