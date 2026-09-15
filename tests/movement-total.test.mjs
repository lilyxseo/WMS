import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadTotalMovement } from '../functions/api/_inventory-analytics.js';

test('Total Movement uses an exact server-side Supabase count with case-insensitive status', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify([{ sku: 'only-the-count-header-matters' }]), {
      status: 200,
      headers: { 'content-range': '0-0/1234' },
    });
  };
  try {
    const total = await loadTotalMovement({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' });
    assert.equal(total, 1234);
    assert.match(request.url, /inventory_barang_masuk\?select=sku&status=ilike\.Movement&limit=1$/);
    assert.equal(request.options.headers.Prefer, 'count=exact');
    assert.doesNotMatch(request.url, /mode=full/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Movement page renders and refreshes the global aggregate independently of page rows', async () => {
  const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const aggregate = source.slice(source.indexOf('async function refreshMovementTotal'), source.indexOf('function renderMovementTotal'));
  assert.match(aggregate, /fetchJsonSafe\('\/api\/movement\/summary'/);
  assert.doesNotMatch(aggregate, /mode=full|\.length/);
  assert.match(source, /if\(activePage==='movement'\)return refreshMovementTotal\(\)/);
  assert.match(source, /await syncData\(\{silent:true,force:true\}\);await refreshMovementTotal\(\)/);
  assert.match(source, /id='movementTotalValue'/);
});
