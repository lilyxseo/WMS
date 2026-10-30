import test from 'node:test';
import assert from 'node:assert/strict';
import { handleManualBarangMasukSync } from '../functions/api/sync/inventory/barang-masuk.js';

const SECRET = 'inventory-secret';
const request = authorization => new Request('https://example.test/api/sync/inventory/barang-masuk', { method: 'POST', headers: authorization ? { Authorization: authorization } : {} });

test('Barang Masuk manual endpoint uses the shared inventory bearer secret', async () => {
  const response = await handleManualBarangMasukSync({ request: request(`Bearer ${SECRET}`), env: { INVENTORY_SYNC_SECRET: SECRET } }, { sync: async () => ({ success: true, source: 'barang_masuk', sourceRows: 1, inserted: 1, updated: 0, deleted: 0, unchanged: 0, invalidRows: 0, durationMs: 1 }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, 'barang_masuk');
});

test('Barang Masuk manual endpoint rejects missing or incorrect secrets', async () => {
  for (const authorization of [undefined, 'Bearer wrong']) {
    const response = await handleManualBarangMasukSync({ request: request(authorization), env: { INVENTORY_SYNC_SECRET: SECRET } }, { sync: async () => assert.fail('sync must not run') });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, reason: 'UNAUTHORIZED' });
  }
});

test('manual refresh allows a proven checksum fast path and full reconciliation remains explicit',async()=>{for(const [query,expected]of [['',false],['?full=1',true]]){let actual;const response=await handleManualBarangMasukSync({request:new Request('https://example.test/api/sync/inventory/barang-masuk'+query,{method:'POST',headers:{Authorization:'Bearer '+SECRET}}),env:{INVENTORY_SYNC_SECRET:SECRET}},{sync:async(_env,options)=>{actual=options.forceFull;return {success:true};}});assert.equal(response.status,200);assert.equal(actual,expected);}});
