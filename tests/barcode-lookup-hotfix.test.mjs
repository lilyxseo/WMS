import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleBarcodeLookupRequest } from '../functions/api/barcode-lookup.js';

const env = {
  SUPABASE_URL: 'https://db.example',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_client',
  SUPABASE_SECRET_KEY: 'sb_secret_server',
  PREVIEW_BYPASS_LOGIN: 'true',
};
const request = (barcode, authenticated = true) => new Request(`https://app.example/api/barcode-lookup?barcode=${encodeURIComponent(barcode)}`, {
  headers: authenticated ? { 'x-preview-bypass-login': 'true' } : {},
});

test('known barcode uses one exact Supabase query and returns JSON SKU', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calledUrl;
  globalThis.fetch = async url => {
    calledUrl = new URL(url);
    return Response.json([{ barcode: '8990001', sku: '682200005566' }]);
  };
  const response = await handleBarcodeLookupRequest({ request: request('8990001'), env });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { success: true, found: true, sku: '682200005566' });
  assert.equal(calledUrl.pathname, '/rest/v1/inventory_barcode');
  assert.equal(calledUrl.searchParams.get('select'), 'barcode,sku');
  assert.equal(calledUrl.searchParams.get('barcode'), 'eq.8990001');
  assert.equal(calledUrl.searchParams.get('limit'), '1');
  assert.doesNotMatch(calledUrl.href, /mode=full/);
});

test('unknown barcode is a successful JSON not-found response', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json([]);
  const response = await handleBarcodeLookupRequest({ request: request('UNKNOWN'), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, found: false });
});

test('missing authentication is JSON 401 and is not reported as not-found', async () => {
  const response = await handleBarcodeLookupRequest({ request: request('8990001', false), env });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { success: false, error: 'UNAUTHORIZED' });
});

test('database exception is converted to a safe JSON 500', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ code: '42703', message: 'column does not exist' }, { status: 400 });
  const response = await handleBarcodeLookupRequest({ request: request('8990001'), env });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: 'BARCODE_LOOKUP_FAILED' });
});

test('frontend barcode lookup safely handles non-JSON failures and avoids full BARCODE load', async () => {
  const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const lookup = source.slice(source.indexOf('async function resolveScannedSku'), source.indexOf('function triggerSearchSku'));
  const open = source.slice(source.indexOf('async function openBarcodeScanner'), source.indexOf('async function openScannerModal'));
  assert.match(lookup, /getAuthHeaders\(\)/);
  assert.match(lookup, /headers\.Authorization/);
  assert.match(lookup, /content-type/);
  assert.match(lookup, /response\.text\(\)/);
  assert.match(lookup, /Barcode lookup failed: HTTP/);
  assert.doesNotMatch(lookup, /response\.json\(\).*response\.json\(/s);
  assert.doesNotMatch(open, /loadBarcodeMaster|fetchSheet|mode=.?full/);
});
