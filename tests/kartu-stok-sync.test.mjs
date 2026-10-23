import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSourceRowKey, diffRows, fetchKartuStokValues, normalizeLocation, normalizeNumber,
  normalizeSku, parseKartuStokValues, syncKartuStok,
} from '../functions/api/sync/inventory/_kartu-stok-service.js';

const HEADER = ['LOKASI BULKY', 'SKU', 'NAMA BARANG', 'STOK AWAL', 'INTERNAL STOCK TRANSFER', 'REPLENISHMENT', 'PENGELUARAN', 'STOK AKHIR'];
const sheetRow = (sku, final = '10', location = ' a%20-01 ') => [location, sku, `Produk ${sku}`, '1,000', 2, '', 4, final];
const silentLogger = { log() {}, error() {} };

function gateway(existing = []) {
  const calls = { upserts: [], deletes: [], success: [], errors: [], histories: [] };
  return {
    calls,
    async acquireLock() { return true; },
    async insertHistory(row) { calls.histories.push(row); return 'history-1'; },
    async updateHistory(_id, row) { calls.histories.push(row); },
    async existingMetadata() { return existing; },
    async upsertRows(rows) { calls.upserts.push(...rows); },
    async deleteKeys(keys) { calls.deletes.push(...keys); },
    async finishSuccess(args) { calls.success.push(args); },
    async finishError(...args) { calls.errors.push(args); },
  };
}

test('normalization preserves business identifiers and rejects invalid numbers', () => {
  assert.equal(normalizeSku(' AB–12\u200b '), 'AB-12');
  assert.equal(normalizeLocation(' a%20–  01 '), 'A - 01');
  assert.deepEqual(normalizeNumber('1,000'), { valid: true, value: 1000 });
  assert.deepEqual(normalizeNumber(''), { valid: true, value: null });
  assert.deepEqual(normalizeNumber('#VALUE!'), { valid: false });
  assert.equal(buildSourceRowKey(2), 'kartu_stok:2');
});

test('header is trim/case insensitive and original row numbers form identity', async () => {
  const parsed = await parseKartuStokValues([HEADER.map(value => ` ${value.toLowerCase()} `), sheetRow('SKU-1'), [], sheetRow('SKU-2')]);
  assert.deepEqual(parsed.rows.map(row => row.source_row_number), [2, 4]);
  assert.deepEqual(parsed.rows.map(row => row.source_row_key), ['kartu_stok:2', 'kartu_stok:4']);
  assert.equal(parsed.rows[0].stok_awal, 1000);
});

test('missing required header aborts parsing', async () => {
  await assert.rejects(() => parseKartuStokValues([HEADER.filter(value => value !== 'PENGELUARAN')]), error => error.code === 'INVALID_HEADER');
});

test('invalid SKU and numeric rows are diagnostic and retained in source key set', async () => {
  const parsed = await parseKartuStokValues([HEADER, sheetRow('', '#VALUE!')]);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.invalidRows.length, 1);
  assert.equal(parsed.sourceKeys.has('kartu_stok:2'), true);
  assert.deepEqual(parsed.invalidRows[0].errors, ['SKU_REQUIRED', 'INVALID_NUMBER:STOK AKHIR']);
});

test('diff handles first sync, idempotency, change, addition, and removal', async () => {
  const parsed = await parseKartuStokValues([HEADER, sheetRow('A'), sheetRow('B')]);
  const first = diffRows(parsed.rows, parsed.sourceKeys, []);
  assert.equal(first.rowsToInsert.length, 2);
  const sameExisting = parsed.rows.map(({ source_row_key, source_hash }) => ({ source_row_key, source_hash }));
  const same = diffRows(parsed.rows, parsed.sourceKeys, sameExisting);
  assert.deepEqual([same.rowsToInsert.length, same.rowsToUpdate.length, same.keysToDelete.length, same.unchanged], [0, 0, 0, 2]);
  const changed = diffRows(parsed.rows, parsed.sourceKeys, [{ ...sameExisting[0], source_hash: 'old' }, sameExisting[1]]);
  assert.equal(changed.rowsToUpdate.length, 1);
  const addition = diffRows(parsed.rows, parsed.sourceKeys, [sameExisting[0]]);
  assert.equal(addition.rowsToInsert.length, 1);
  const removalSource = new Set(['kartu_stok:2']);
  const removal = diffRows([parsed.rows[0]], removalSource, sameExisting);
  assert.deepEqual(removal.keysToDelete, ['kartu_stok:3']);
});

test('successful worker batches calculated mutations and finishes status/history', async () => {
  const db = gateway([]);
  const result = await syncKartuStok({}, { gateway: db, fetchValues: async () => [HEADER, sheetRow('A')], logger: silentLogger });
  assert.equal(result.inserted, 1);
  assert.equal(db.calls.upserts.length, 1);
  assert.equal(db.calls.success.length, 1);
  assert.equal(db.calls.histories.at(-1).status, 'success');
});

test('Supabase lock and success RPCs use exact PostgreSQL parameter names', async () => {
  const rpcCalls = [];
  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.includes('/rpc/')) rpcCalls.push({ path, body: JSON.parse(options.body) });
    if (path.endsWith('/rpc/acquire_inventory_sync_fast')) return { ok: true, status: 200, json: async () => ({acquired:true,allow_fast:false}) };
    if (path.endsWith('/inventory_sync_history') && options.method === 'POST') return { ok: true, status: 201, json: async () => [{ id: 'history-1' }] };
    if (path.endsWith('/inventory_kartu_stok') && !options.method) return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 204, json: async () => null };
  };

  await syncKartuStok({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' }, {
    fetch, fetchValues: async () => [HEADER, sheetRow('A')], logger: silentLogger,
  });

  assert.deepEqual(rpcCalls[0].body, {
    p_source: 'kartu_stok', p_lock_id: rpcCalls[0].body.p_lock_id, p_stale_after_seconds: 120,
  });
  assert.deepEqual(Object.keys(rpcCalls[1].body), [
    'p_source', 'p_lock_id', 'p_row_count', 'p_inserted_count', 'p_updated_count',
    'p_deleted_count', 'p_duration_ms', 'p_source_version','p_full',
  ]);
});

test('Supabase error RPC uses exact PostgreSQL parameter names', async () => {
  const rpcCalls = [];
  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.includes('/rpc/')) rpcCalls.push({ path, body: JSON.parse(options.body) });
    if (path.endsWith('/rpc/acquire_inventory_sync_fast')) return { ok: true, status: 200, json: async () => ({acquired:true,allow_fast:false}) };
    if (path.endsWith('/inventory_sync_history') && options.method === 'POST') return { ok: true, status: 201, json: async () => [{ id: 'history-1' }] };
    return { ok: true, status: 204, json: async () => null };
  };

  await assert.rejects(() => syncKartuStok({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' }, {
    fetch, fetchValues: async () => { throw new Error('Google down'); }, logger: silentLogger,
  }));

  assert.deepEqual(Object.keys(rpcCalls[1].body), ['p_source', 'p_lock_id', 'p_error', 'p_duration_ms']);
  assert.equal(rpcCalls[1].body.p_source, 'kartu_stok');
  assert.match(rpcCalls[1].body.p_error, /Google down/);
});

test('concurrent lock loser is skipped before Google fetch', async () => {
  const db = gateway(); db.acquireLock = async () => false;
  let fetched = false;
  const result = await syncKartuStok({}, { gateway: db, fetchValues: async () => { fetched = true; return []; }, logger: silentLogger });
  assert.equal(result.reason, 'SYNC_ALREADY_RUNNING');
  assert.equal(fetched, false);
  assert.equal(db.calls.histories[0].status, 'skipped');
});

test('Google/parse errors preserve data, mark error, and release lock', async () => {
  const db = gateway([{ source_row_key: 'kartu_stok:2', source_hash: 'safe' }]);
  await assert.rejects(() => syncKartuStok({}, { gateway: db, fetchValues: async () => { throw new Error('Google down'); }, logger: silentLogger }));
  assert.equal(db.calls.upserts.length, 0); assert.equal(db.calls.deletes.length, 0);
  assert.equal(db.calls.errors.length, 1); assert.equal(db.calls.histories.at(-1).status, 'error');
});

test('empty and unexpectedly small sources cannot trigger destructive delete', async () => {
  const one = gateway([{ source_row_key: 'kartu_stok:2', source_hash: 'safe' }]);
  await assert.rejects(() => syncKartuStok({}, { gateway: one, fetchValues: async () => [HEADER], logger: silentLogger }), error => error.code === 'SUSPICIOUS_SOURCE_SIZE');
  assert.equal(one.calls.deletes.length, 0);
  const manyRows = Array.from({ length: 101 }, (_, i) => ({ source_row_key: `kartu_stok:${i + 2}`, source_hash: 'x' }));
  const many = gateway(manyRows);
  await assert.rejects(() => syncKartuStok({}, { gateway: many, fetchValues: async () => [HEADER, sheetRow('ONLY')], logger: silentLogger }), error => error.code === 'SOURCE_ROW_COUNT_DROPPED_UNEXPECTEDLY');
  assert.equal(many.calls.deletes.length, 0);
});

test('Google 429 uses bounded exponential backoff then succeeds', async () => {
  const waits = [], statuses = [429, 429, 429, 200];
  const values = await fetchKartuStokValues({ SHEET_ID_2026: 'existing-id' }, {
    getGoogleAccessToken: async () => 'private-token', sleep: async ms => waits.push(ms),
    fetch: async () => { const status = statuses.shift(); return { status, ok: status === 200, async json() { return status === 200 ? { values: [HEADER] } : { error: { message: 'quota' } }; } }; },
  });
  assert.deepEqual(waits, [2000, 5000, 10000]);
  assert.deepEqual(values, [HEADER]);
});
