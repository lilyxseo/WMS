import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleDashboardSummaryRequest } from '../functions/api/dashboard-summary.js';

test('dashboard daily response is explicit and cannot be HTTP-cached', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    const isDaily = parsed.searchParams.has('or');
    const outgoing = parsed.pathname.endsWith('/inventory_barang_keluar');
    const inbound = parsed.pathname.endsWith('/inventory_barang_masuk');
    const total = isDaily && outgoing ? 2 : isDaily && inbound ? 1 : 0;
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-range': `*/${total}` } });
  };
  try {
    const response = await handleDashboardSummaryRequest({
      request: new Request('https://app.test/api/dashboard-summary', { headers: { 'x-preview-bypass-login': 'true' } }),
      env: { PREVIEW_BYPASS_LOGIN: 'true', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' },
    });
    const body = await response.json();
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(body.today, body.summary.today);
    assert.equal(body.barangMasukToday, body.summary.barangMasukHariIni);
    assert.equal(body.barangKeluarToday, body.summary.barangKeluarHariIni);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dashboard request cache key includes local date and the shared fetch bypasses cache', async () => {
  const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const loader = source.slice(source.indexOf('async function loadDashboardSummary()'), source.indexOf('async function loadDashboardRecentTransactions()'));
  assert.match(loader, /dashboard-summary'[+]`\?today=/);
  assert.match(source, /fetch\(url,\{cache:'no-store'\}\)/);
});
