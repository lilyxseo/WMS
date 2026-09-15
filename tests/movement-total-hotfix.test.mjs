import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleMovementSummaryRequest } from '../functions/api/movement-summary.js';

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SECRET_KEY: 'sb_secret_server-only' };

test('movement summary counts all case variants in Barang Masuk without downloading rows', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('[]', { status: 200, headers: { 'content-range': '*/1234' } });
  };
  try {
    const response = await handleMovementSummaryRequest({ env });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      success: true,
      source: 'supabase',
      table: 'public.inventory_barang_masuk',
      status: 'Movement',
      totalMovement: 1234,
    });
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/rest/v1/inventory_barang_masuk');
    assert.equal(url.searchParams.get('select'), 'status');
    assert.equal(url.searchParams.get('status'), 'ilike.Movement');
    assert.equal(url.searchParams.get('limit'), '0');
    assert.equal(calls[0].options.headers.Prefer, 'count=exact');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Movement page uses the aggregate independently of history pagination and refreshes it', async () => {
  const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const totalLoader = source.slice(source.indexOf('async function refreshMovementTotal'), source.indexOf('function buildMovementHistoryRows'));
  assert.match(totalLoader, /fetchJsonSafe\('\/api\/movement-summary'\)/);
  assert.doesNotMatch(totalLoader, /mode=full|movementHistoryPage|pageRows|localStorage/);
  assert.match(source, /refreshMovementTotal\(\{force:true\}\)/);
  assert.match(source, /Promise\.all\(\[ensureMovementHistoryLoaded\(\),refreshMovementTotal\(\{force:true\}\)\]\)/);
  assert.match(source, /id='movementTotalValue'/);
});
