import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInventorySyncAll, orchestrateInventorySync } from '../functions/api/sync/inventory/all.js';

test('authenticated all-source endpoint returns structured partial success and settles every source sequentially', async () => {
  const order = [];
  const sources = [
    ['barang_masuk', async () => { order.push('masuk'); return { success: true, inserted: 2 }; }],
    ['rpl', async () => { order.push('rpl'); throw Object.assign(new Error('private upstream detail'), { code: 'SOURCE_DOWN' }); }],
    ['bulky', async () => { order.push('bulky'); return { success: true, updated: 1 }; }],
  ];
  const result = await orchestrateInventorySync({}, { sources });
  assert.deepEqual(order, ['masuk', 'rpl', 'bulky']);
  assert.equal(result.success, false);
  assert.equal(result.partialSuccess, true);
  assert.equal(result.sources.barangMasuk.success, true);
  assert.deepEqual(result.sources.rpl, { success: false, reason: 'SOURCE_DOWN' });
  assert.equal(result.sources.bulky.success, true);
  assert.equal(typeof result.durationMs, 'number');
});

test('application endpoint requires an authenticated application session, not the sync secret', async () => {
  const request = new Request('https://example.test/api/sync/inventory/all', { method: 'POST' });
  const response = await handleInventorySyncAll({ request, env: {} }, { run: async () => assert.fail('must not sync') });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).reason, 'UNAUTHORIZED');
});

test('settled partial failures still use HTTP 200 so the frontend can refresh successful data', async () => {
  const request = new Request('https://example.test/api/sync/inventory/all', {
    method: 'POST', headers: { 'x-preview-bypass-login': 'true' },
  });
  const result = { success: false, partialSuccess: true, sources: { rpl: { success: false, reason: 'SYNC_FAILED' } }, durationMs: 12 };
  const response = await handleInventorySyncAll({ request, env: { PREVIEW_BYPASS_LOGIN: 'true' } }, { run: async () => result });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
});
