import test from 'node:test';
import assert from 'node:assert/strict';
import { handleKartuStokRequest, mapKartuStokRow } from '../functions/api/kartu-stok/index.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only', PREVIEW_BYPASS_LOGIN: 'true' };
const request = path => new Request(`https://app.example/api/kartu-stok${path}`, { headers: { 'x-preview-bypass-login': 'true' } });

test('adapter preserves the Kartu Stock frontend keys and numeric details', () => {
  assert.deepEqual(mapKartuStokRow({ lokasi_bulky: 'A-1', sku: 'SKU-1', nama_barang: 'Produk', stok_awal: 2, internal_stock_transfer: 3, replenishment: 4, pengeluaran: 1, stok_akhir: 8, source_row_number: 9, synced_at: '2026-08-31T00:00:00Z' }), {
    lokasi: 'A-1', 'lokasi bulky': 'A-1', sku: 'SKU-1', 'nama barang': 'Produk', 'stok awal': 2, 'internal stock transfer': 3, replenishment: 4, pengeluaran: 1, 'stok akhir': 8, source_row_number: 9, synced_at: '2026-08-31T00:00:00Z',
  });
});

test('endpoint applies server-side SKU/name/location filters and returns sync freshness', async () => {
  const urls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('inventory_sync_status')) return new Response(JSON.stringify([{ source: 'kartu_stok', last_success_at: '2026-08-31T00:00:00Z' }]), { status: 200 });
    return new Response(JSON.stringify([{ lokasi_bulky: 'A-1', sku: 'SKU-1', nama_barang: 'Produk', stok_akhir: 8 }]), { status: 200, headers: { 'content-range': '0-0/1' } });
  };
  try {
    const response = await handleKartuStokRequest({ request: request('?sku=SKU-1&search=Produk&lokasi=A-1&page=1&pageSize=50'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, 'supabase');
    assert.equal(body.total, 1);
    assert.equal(body.data[0]['stok akhir'], 8);
    assert.equal(body.syncStatus.source, 'kartu_stok');
    const statusUrl = urls.find(url => url.includes('inventory_sync_status'));
    assert.equal(new URL(statusUrl).searchParams.get('select'), '*');
    assert.doesNotMatch(statusUrl, /last_attempt_at/);
    assert.match(urls[0], /sku=ilike/);
    assert.match(urls[0], /nama_barang\.ilike/);
    assert.match(urls[0], /lokasi_bulky\.ilike/);
    assert.equal(urls.some(url => url.includes('googleapis.com')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('Supabase failures are explicit and never fall back to Google Sheets', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ message: 'database unavailable' }), { status: 503 }); };
  try {
    const response = await handleKartuStokRequest({ request: request('?page=1'), env });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.message, /Supabase.*database unavailable/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
