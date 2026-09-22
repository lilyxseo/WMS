import test from 'node:test';
import assert from 'node:assert/strict';
import { RPL_SHEET_NAME, buildSourceRowKey, parseRplValues, syncRpl } from '../functions/api/sync/inventory/_rpl-service.js';

const HEADER = [
  'LOKASI BULKY', 'SKU', 'NAMA BARANG', 'STOK AWAL', 'INTERNAL STOCK TRANSFER', 'REPLENISHMENT',
  'PENGELUARAN', 'STOK AKHIR', 'NETSUITE',
];
const row = (sku, stokAkhir = '12', netsuite = '10,081') => [' rak%20rpl ', sku, ` Produk ${sku} `, '10', '2', '3', '3', stokAkhir, netsuite];
const logger = { log() {}, error() {} };

function statefulGateway() {
  const records = new Map();
  const status = { status: null, locked_at: null, lock_id: null };
  return {
    records, status,
    async acquireLock(source, lockId) { assert.equal(source, 'rpl'); status.status = 'syncing'; status.locked_at = new Date().toISOString(); status.lock_id = lockId; return true; },
    async insertHistory() { return 'history-rpl'; }, async updateHistory() {},
    async existingMetadata() { return [...records.values()].map(({ source_row_key, source_hash }) => ({ source_row_key, source_hash })); },
    async upsertRows(rows) { rows.forEach(item => records.set(item.source_row_key, item)); },
    async deleteKeys(keys) { keys.forEach(key => records.delete(key)); },
    async finishSuccess(args) { assert.equal(args.source, 'rpl'); status.status = 'success'; status.locked_at = null; status.lock_id = null; },
    async finishError() {},
  };
}

test('RPL maps and normalizes all business fields with the requested row key and hash', async () => {
  const parsed = await parseRplValues([HEADER.map(header => ` ${header.toLowerCase()} `), row('SKU–1')]);
  assert.equal(buildSourceRowKey(2), 'rpl:2');
  assert.deepEqual(parsed.rows[0], {
    lokasi_bulky: 'RAK RPL', sku: 'SKU-1', nama_barang: 'Produk SKU–1', stok_awal: 10,
    internal_stock_transfer: 2, replenishment: 3, pengeluaran: 3, stok_akhir: 12,
    netsuite: 10081,
    source_row_key: 'rpl:2', source_row_number: 2, source_hash: parsed.rows[0].source_hash,
  });
  assert.match(parsed.rows[0].source_hash, /^[a-f0-9]{64}$/);
});

test('RPL NETSUITE is nullable, numeric, and participates in source_hash', async () => {
  const populated = await parseRplValues([HEADER, row('SKU-1', '12', '10081')]);
  const comma = await parseRplValues([HEADER, row('SKU-1', '12', '10,081')]);
  const blank = await parseRplValues([HEADER, row('SKU-1', '12', '')]);
  const changed = await parseRplValues([HEADER, row('SKU-1', '12', '10082')]);
  assert.equal(populated.rows[0].netsuite, 10081);
  assert.equal(comma.rows[0].netsuite, 10081);
  assert.equal(blank.rows[0].netsuite, null);
  assert.equal(populated.rows[0].source_hash, comma.rows[0].source_hash);
  assert.notEqual(populated.rows[0].source_hash, changed.rows[0].source_hash);

  const invalid = await parseRplValues([HEADER, row('SKU-1', '12', 'not-a-number')]);
  assert.deepEqual(invalid.invalidRows[0].errors, ['INVALID_NUMBER:NETSUITE']);
  assert.deepEqual(invalid.reportMetrics, { nullNetsuiteRows: 0, invalidNetsuiteValues: 1 });
});

test('RPL validates headers and diagnoses invalid non-empty numbers without coercing them', async () => {
  await assert.rejects(() => parseRplValues([HEADER.slice(1)]), error => error.code === 'INVALID_HEADER');
  const invalid = row('SKU-1'); invalid[3] = '#VALUE!'; invalid[7] = 'not-a-number';
  const parsed = await parseRplValues([HEADER, invalid]);
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.invalidRows, [{ sourceRowNumber: 2, sourceRowKey: 'rpl:2', errors: ['INVALID_NUMBER:STOK AWAL', 'INVALID_NUMBER:STOK AKHIR'] }]);
  assert.equal(parsed.sourceKeys.has('rpl:2'), true);
});

test('RPL first and unchanged second sync have valid row count, idempotent diff, released lock, and safe request estimate', async () => {
  const gateway = statefulGateway();
  const invalid = row('INVALID'); invalid[6] = 'invalid';
  const values = [HEADER, row('A'), row('B'), invalid];
  const run = () => syncRpl({}, { gateway, fetchValues: async () => values, logger });

  const first = await run();
  assert.deepEqual([first.success, first.sourceRows, first.invalidRows, first.inserted, first.updated, first.deleted], [true, 3, 1, 2, 0, 0]);
  assert.equal(gateway.records.size, 2);
  assert.deepEqual(gateway.status, { status: 'success', locked_at: null, lock_id: null });
  assert.deepEqual([first.nullNetsuiteRows, first.invalidNetsuiteValues], [0, 0]);

  const second = await run();
  assert.deepEqual([second.inserted, second.updated, second.deleted, second.unchanged], [0, 0, 0, 2]);
  assert.equal(gateway.records.size, 2);
  assert.deepEqual(gateway.status, { status: 'success', locked_at: null, lock_id: null });
  assert.ok(second.requests.estimatedRequests < 50);
});

test('RPL uses the actual configured tab name separately from its source identifier', async () => {
  const messages = [];
  await syncRpl({ SHEET_ID_2026: 'spreadsheet-id' }, {
    gateway: statefulGateway(), fetchValues: async () => [HEADER, row('A')],
    logger: { log(message) { messages.push(message); }, error() {} },
  });
  assert.equal(RPL_SHEET_NAME, 'stok retail');
  assert.equal(messages[0], "[InventorySync:rpl]\nsheetName: stok retail\nrange: 'stok retail'!A:ZZ");
  assert.doesNotMatch(messages.join('\n'), /spreadsheet-id/);
});
