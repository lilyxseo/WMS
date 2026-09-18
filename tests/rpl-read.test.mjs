import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRplRequest, mapRplRow } from '../functions/api/rpl/index.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only' };
const request = query => new Request(`https://app.example/api/rpl${query}`);

test('RPL adapter preserves the existing frontend row shape', () => {
  assert.deepEqual(mapRplRow({ lokasi_bulky: 'RAK RPL', sku: 'SKU-1', nama_barang: 'Produk', stok_awal: 2, internal_stock_transfer: 3, replenishment: 4, pengeluaran: 1, stok_akhir: 8, netsuite: 6, source_row_number: 9, synced_at: '2026-08-31T00:00:00Z' }), {
    lokasi: 'RAK RPL', 'lokasi bulky': 'RAK RPL', sku: 'SKU-1', 'nama barang': 'Produk', 'stok awal': 2, 'internal stock transfer': 3, replenishment: 4, pengeluaran: 1, 'stok akhir': 8, netsuite: 6, selisih: 2, source_row_number: 9, synced_at: '2026-08-31T00:00:00Z',
  });
});

test('RPL adapter preserves missing NETSUITE instead of treating it as zero', () => {
  const mapped = mapRplRow({ sku: 'SKU-NULL', stok_akhir: 8, netsuite: null });
  assert.equal(mapped.netsuite, null);
  assert.equal(mapped.selisih, null);
});

test('GET /api/rpl paginates and applies SKU, name, and location filters in Supabase', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('inventory_sync_status')) return new Response(JSON.stringify([{ source: 'rpl', status: 'success', last_success_at: '2026-08-31T01:00:00Z' }]), { status: 200 });
    return new Response(JSON.stringify([{ lokasi_bulky: 'RAK RPL', sku: 'SKU-1', nama_barang: 'Produk', stok_akhir: 8 }]), { status: 200, headers: { 'content-range': '100-100/205' } });
  };
  try {
    const response = await handleRplRequest({ request: request('?page=2&limit=500&sku=SKU-1&q=Produk&lokasi=RAK%20RPL'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.total, 205);
    assert.equal(body.limit, 100);
    assert.equal(body.lastSync, '2026-08-31T01:00:00Z');
    assert.equal(body.syncStatus.source, 'rpl');
    assert.equal(body.data[0]['nama barang'], 'Produk');
    const dataUrl = calls[0].url;
    assert.match(dataUrl, /offset=100&limit=100/);
    assert.match(dataUrl, /sku=ilike/);
    assert.match(dataUrl, /nama_barang=ilike/);
    assert.match(dataUrl, /lokasi_bulky=eq/);
    assert.equal(calls[0].options.headers.apikey, env.SUPABASE_SECRET_KEY);
    assert.equal(calls.some(call => call.url.includes('googleapis.com')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('RPL defaults to 50 rows and returns a clear JSON error without Google fallback', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response(JSON.stringify({ message: 'database unavailable' }), { status: 503 });
  };
  try {
    const response = await handleRplRequest({ request: request(''), env });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.reason, 'RPL_FETCH_FAILED');
    assert.match(body.message, /Supabase.*database unavailable/);
    assert.match(urls[0], /offset=0&limit=50/);
    assert.equal(urls.some(url => url.includes('googleapis.com')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('RPL full mode batches all Supabase rows for the unchanged UI contract', async () => {
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
    const response = await handleRplRequest({ request: request('?mode=full'), env });
    const body = await response.json();
    assert.equal(body.data.length, 1002);
    assert.equal(body.total, 1002);
    assert.equal(urls.filter(url => url.includes('inventory_rpl')).length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('frontend routes RPL through its backend full-mode endpoint', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../assets/js/api.js', import.meta.url), 'utf8'));
  assert.match(source, /'RPL': '\/api\/rpl\?mode=full'/);
});
