import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleInventorySyncStatusRequest } from '../functions/api/inventory-sync-status.js';

const main = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../assets/js/supabase.js', import.meta.url), 'utf8');

test('login persists and verifies the session before protected startup requests', () => {
  const setSession = auth.indexOf('await supabase.auth.setSession');
  const getSession = auth.indexOf('await supabase.auth.getSession()', setSession);
  assert.ok(setSession >= 0 && getSession > setSession);
  assert.match(auth.slice(getSession), /sessionData\?\.session\?\.access_token/);
  const login = main.slice(main.indexOf('form.addEventListener("submit"'), main.indexOf("signupForm?.addEventListener"));
  assert.ok(login.indexOf('supabase.auth.getSession()') < login.indexOf('isAuthStateReady=true'));
  assert.ok(login.indexOf('isAuthStateReady=true') < login.indexOf('void startInitialPrefetch()'));
  assert.doesNotMatch(login, /await initAppData\(\)/);
});

test('dashboard prefetch and sync-status reads are non-blocking and use current auth headers', () => {
  assert.match(main, /void startInitialPrefetch\(\);\s*void loadInventorySyncStatus\(\)/);
  for (const endpoint of ['/api/dashboard-summary', '/api/inventory-sync-status']) {
    const call = main.slice(main.indexOf(`fetchJsonSafe('${endpoint}'`) - 100, main.indexOf(`fetchJsonSafe('${endpoint}'`) + 180);
    assert.match(call, /await getAuthHeaders\(\)/);
    assert.match(call, /\{headers(?:,cache:'no-store')?\}/);
  }
  assert.match(main, /AUTHENTICATED_INVENTORY_PATHS=new Set\(\[[^\]]*'\/api\/dashboard-summary'[^\]]*'\/api\/inventory-sync-status'/);
});

test('sidebar distinguishes loading, failure, never-synced, and successful sync', () => {
  assert.match(main, /Memuat status sinkronisasi/);
  assert.match(main, /Status gagal dimuat/);
  assert.match(main, /if\(!dbSync\)\{lastSync\.textContent="Belum sinkron"/);
  assert.match(main, /window\.__inventorySyncStatus=data\.syncStatus\|\|null/);
  assert.doesNotMatch(main.slice(main.indexOf('function renderInventorySyncStatus'), main.indexOf('async function loadInventorySyncStatus')), /DATA\[/);
});

test('sync status endpoint reads latest successful database timestamp', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'u@example.com' }));
    if (String(url).includes('/rest/v1/users')) return new Response(JSON.stringify([{ role: 'Warga KST' }]));
    return new Response(JSON.stringify([{ source: 'kartu_stok', last_success_at: '2026-09-03T10:00:00Z' }]));
  };
  try {
    const request = new Request('https://example.test/api/inventory-sync-status', { headers: { 'x-preview-bypass-login': 'true' } });
    const response = await handleInventorySyncStatusRequest({ request, env: { SUPABASE_URL: 'https://db.test', SUPABASE_SECRET_KEY: 'sb_secret_service', PREVIEW_BYPASS_LOGIN: 'true' } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.last_success_at, '2026-09-03T10:00:00Z');
    assert.ok(calls.some(url => url.includes('inventory_sync_status?select=*&last_success_at=not.is.null&order=last_success_at.desc&limit=1')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
