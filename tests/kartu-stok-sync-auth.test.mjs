import test from 'node:test';
import assert from 'node:assert/strict';
import { handleManualKartuStokSync } from '../functions/api/sync/inventory/kartu-stok.js';

const SECRET = 'test-inventory-sync-secret';
const syncResult = { success: true, source: 'kartu_stok', sourceRows: 1, inserted: 1, updated: 0, deleted: 0, unchanged: 0 };

function request(authorization) {
  return new Request('https://example.test/api/sync/inventory/kartu-stok', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
  });
}

async function invoke({ authorization, configuredSecret = SECRET } = {}) {
  let syncCalls = 0;
  const response = await handleManualKartuStokSync({
    request: request(authorization),
    env: { INVENTORY_SYNC_SECRET: configuredSecret },
  }, {
    sync: async () => { syncCalls += 1; return syncResult; },
  });
  return { response, body: await response.json(), syncCalls };
}

test('valid inventory sync bearer secret starts sync', async () => {
  const result = await invoke({ authorization: `Bearer ${SECRET}` });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.syncCalls, 1);
});

test('authenticated application session can start an isolated source sync', async () => {
  let syncCalls = 0;
  const response = await handleManualKartuStokSync({
    request: new Request('https://example.test/api/sync/inventory/kartu-stok', {
      method: 'POST', headers: { 'x-preview-bypass-login': 'true' },
    }),
    env: { PREVIEW_BYPASS_LOGIN: 'true' },
  }, { sync: async () => { syncCalls += 1; return syncResult; } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(syncCalls, 1);
});

test('missing Authorization header returns simple 401 response', async () => {
  const result = await invoke();
  assert.equal(result.response.status, 401);
  assert.deepEqual(result.body, { success: false, reason: 'UNAUTHORIZED' });
  assert.equal(result.syncCalls, 0);
});

test('incorrect bearer secret cannot start sync', async () => {
  const result = await invoke({ authorization: 'Bearer wrong-secret' });
  assert.equal(result.response.status, 401);
  assert.deepEqual(result.body, { success: false, reason: 'UNAUTHORIZED' });
  assert.equal(result.syncCalls, 0);
});

test('non-Bearer authorization scheme is rejected', async () => {
  const result = await invoke({ authorization: `Basic ${SECRET}` });
  assert.equal(result.response.status, 401);
  assert.equal(result.syncCalls, 0);
});

test('endpoint stays closed when server secret is not configured', async () => {
  const result = await invoke({ authorization: `Bearer ${SECRET}`, configuredSecret: '' });
  assert.equal(result.response.status, 401);
  assert.equal(result.syncCalls, 0);
});
