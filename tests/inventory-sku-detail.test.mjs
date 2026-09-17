import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleInventorySkuDetailRequest } from '../functions/api/inventory-sku-detail.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only', PREVIEW_BYPASS_LOGIN: 'true' };
const request = sku => new Request(`https://app.example/api/inventory-sku-detail?sku=${encodeURIComponent(sku)}`, { headers: { 'x-preview-bypass-login': 'true' } });

test('fetches all detail sources with an exact SKU filter and no full-table mode', async () => {
  const urls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    urls.push(String(url));
    const table = new URL(url).pathname.split('/').pop();
    return new Response(JSON.stringify([{ sku: '682200002980', nama_barang: 'Produk', tanggal: '09/15/2026', source_row_number: table.includes('masuk') ? 1 : 2 }]), { status: 200 });
  };
  try {
    const response = await handleInventorySkuDetailRequest({ request: request('682200002980'), env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.found, true);
    assert.deepEqual(Object.keys(body.sources), ['Kartu Stock', 'RPL', 'BULKY', 'Barang Masuk', 'Barang Keluar']);
    assert.equal(urls.length, 5);
    for (const url of urls) {
      assert.equal(new URL(url).searchParams.get('sku'), 'eq.682200002980');
      assert.doesNotMatch(url, /mode=full/);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('returns not found only after every SKU-specific source is empty', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[]', { status: 200 });
  try {
    const response = await handleInventorySkuDetailRequest({ request: request('UNKNOWN'), env });
    assert.deepEqual(await response.json(), {
      success: true,
      found: false,
      sku: 'UNKNOWN',
      sources: { 'Kartu Stock': [], RPL: [], BULKY: [], 'Barang Masuk': [], 'Barang Keluar': [] },
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('orders SKU detail transactions from oldest at the top to newest at the bottom', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const table = new URL(url).pathname.split('/').pop();
    if (!table.includes('barang_')) return new Response('[]', { status: 200 });
    return new Response(JSON.stringify([
      { sku: 'SKU-1', tanggal: '2026-08-29', source_row_number: 3 },
      { sku: 'SKU-1', tanggal: '01/05/2026', source_row_number: 1 },
      { sku: 'SKU-1', tanggal: '2026-03-12', source_row_number: 2 },
    ]), { status: 200 });
  };
  try {
    const response = await handleInventorySkuDetailRequest({ request: request('SKU-1'), env });
    const body = await response.json();
    const expectedDates = ['01/05/2026', '2026-03-12', '2026-08-29'];
    assert.deepEqual(body.sources['Barang Masuk'].map(row => row.tanggal), expectedDates);
    assert.deepEqual(body.sources['Barang Keluar'].map(row => row.tanggal), expectedDates);
  } finally { globalThis.fetch = originalFetch; }
});

test('direct SKU route renders and fetches independently of global caches and hydration', async () => {
  const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const route = source.slice(source.indexOf('function routeFromPath'), source.indexOf('function syncDeveloperMenuVisibility'));
  const detailLoader = source.slice(source.indexOf('async function showDetail'), source.indexOf('function renderSkuDetailPayload'));
  const directRouteGuard = source.slice(source.indexOf('if(location.pathname.startsWith("/sku/"))'), source.indexOf('await hydrateModuleCachesFromDb'));

  assert.match(route, /showPage\("detail"\).*showDetail\(currentSku\)/);
  assert.match(detailLoader, /Memuat detail SKU\.\.\./);
  assert.match(detailLoader, /\/api\/inventory-sku-detail\?sku=/);
  assert.match(detailLoader, /Gagal memuat detail SKU/);
  assert.match(detailLoader, /Coba Lagi/);
  assert.doesNotMatch(detailLoader, /CACHE_SKU|BARANG_MASUK_DATA|BARANG_KELUAR_DATA|APP_STATE|IndexedDB|hydrateAllDataOnInit|preloadData/);
  assert.match(directRouteGuard, /hideInitialLoader\(\);setMainContentLoading\(false\);return;/);
});
