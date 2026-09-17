import test from 'node:test';
import assert from 'node:assert/strict';
import { BULKY_SHEET_NAME, buildSourceRowKey, parseBulkyValues, syncBulky } from '../functions/api/sync/inventory/_bulky-service.js';

const HEADER = [
  'LOKASI BULKY', 'SKU', 'NAMA BARANG', 'STOK AWAL', 'INTERNAL STOCK TRANSFER', 'REPLENISHMENT',
  'PENGELUARAN', 'STOK AKHIR', 'Netsuite',
];
const row = (sku, stokAkhir = '12', netsuite = '11') => [' bulky%20a ', sku, ` Produk ${sku} `, '10', '2', '3', '3', stokAkhir, netsuite];
const logger = { log() {}, error() {} };

function statefulGateway() {
  const records = new Map();
  const status = { status: null, locked_at: null, lock_id: null };
  return {
    records, status,
    async acquireLock(source, lockId) { assert.equal(source, 'bulky'); status.status = 'syncing'; status.locked_at = new Date().toISOString(); status.lock_id = lockId; return true; },
    async insertHistory() { return 'history-1'; }, async updateHistory() {},
    async existingMetadata() { return [...records.values()].map(({ source_row_key, source_hash, netsuite }) => ({ source_row_key, source_hash, netsuite })); },
    async upsertRows(rows) { rows.forEach(item => records.set(item.source_row_key, item)); },
    async deleteKeys(keys) { keys.forEach(key => records.delete(key)); },
    async finishSuccess(args) { assert.equal(args.source, 'bulky'); status.status = 'success'; status.locked_at = null; status.lock_id = null; },
    async finishError() {},
  };
}

test('BULKY maps and normalizes every business field in deterministic hash order', async () => {
  const parsed = await parseBulkyValues([HEADER.map(header => ` ${header.toLowerCase()} `), row('SKU–1')]);
  assert.equal(buildSourceRowKey(2), 'bulky:2');
  assert.deepEqual(parsed.rows[0], {
    lokasi_bulky: 'BULKY A', sku: 'SKU-1', nama_barang: 'Produk SKU–1', stok_awal: 10,
    internal_stock_transfer: 2, replenishment: 3, pengeluaran: 3, stok_akhir: 12, netsuite: 11,
    source_row_key: 'bulky:2', source_row_number: 2, source_hash: parsed.rows[0].source_hash,
  });
  assert.match(parsed.rows[0].source_hash, /^[a-f0-9]{64}$/);
});

test('BULKY validates headers and reports invalid numeric cells without coercing them to zero', async () => {
  await assert.rejects(() => parseBulkyValues([HEADER.slice(1)]), error => error.code === 'INVALID_HEADER');
  const invalid = row('SKU-1'); invalid[3] = '#VALUE!'; invalid[7] = 'not-a-number'; invalid[8] = 'invalid-netsuite';
  const parsed = await parseBulkyValues([HEADER, invalid]);
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.invalidRows, [{ sourceRowNumber: 2, sourceRowKey: 'bulky:2', errors: ['INVALID_NUMBER:STOK AWAL', 'INVALID_NUMBER:STOK AKHIR', 'INVALID_NUMBER:NETSUITE'] }]);
  assert.equal(parsed.sourceKeys.has('bulky:2'), true);
});

test('BULKY backfills missing Netsuite once, preserves blanks, and reports invalid values', async () => {
  const gateway = statefulGateway();
  const source = await parseBulkyValues([HEADER, row('BACKFILL-A', '12', '10075'), row('BACKFILL-B', '8', '8000')]);
  for (const sourceRow of source.rows) {
    gateway.records.set(sourceRow.source_row_key, {
      ...sourceRow,
      netsuite: null,
      // Reproduce a legacy/equivalent hash that alone would classify the row unchanged.
      source_hash: sourceRow.source_hash,
    });
  }
  const values = [HEADER, row('BACKFILL-A', '12', '10075'), row('BACKFILL-B', '8', '8000'), row('BLANK', '5', ''), row('INVALID', '6', 'not-a-number')];
  const run = () => syncBulky({}, { gateway, fetchValues: async () => values, logger });

  const first = await run();
  assert.deepEqual({
    inserted: first.inserted,
    updated: first.updated,
    unchanged: first.unchanged,
    netsuiteSourceValues: first.netsuiteSourceValues,
    netsuiteBackfilledRows: first.netsuiteBackfilledRows,
    nullNetsuiteRows: first.nullNetsuiteRows,
    invalidNetsuiteValues: first.invalidNetsuiteValues,
  }, { inserted: 1, updated: 2, unchanged: 0, netsuiteSourceValues: 2, netsuiteBackfilledRows: 2, nullNetsuiteRows: 1, invalidNetsuiteValues: 1 });
  assert.equal(gateway.records.get('bulky:2').netsuite, 10075);
  assert.equal(gateway.records.get('bulky:2').source_hash, source.rows[0].source_hash);
  assert.equal(gateway.records.get('bulky:3').netsuite, 8000);
  assert.equal(gateway.records.get('bulky:4').netsuite, null);

  const second = await run();
  assert.deepEqual([second.inserted, second.updated, second.unchanged, second.netsuiteBackfilledRows], [0, 0, 3, 0]);
});

test('BULKY first and unchanged second sync preserve valid database count and release status lock', async () => {
  const gateway = statefulGateway();
  const values = [HEADER, row('A'), row('B'), [...row('INVALID')].map((value, index) => index === 6 ? 'invalid' : value)];
  const run = () => syncBulky({}, { gateway, fetchValues: async () => values, logger });

  const first = await run();
  assert.deepEqual([first.success, first.sourceRows, first.invalidRows, first.inserted, first.updated, first.deleted], [true, 3, 1, 2, 0, 0]);
  assert.equal(gateway.records.size, 2);
  assert.deepEqual(gateway.status, { status: 'success', locked_at: null, lock_id: null });

  const second = await run();
  assert.deepEqual([second.inserted, second.updated, second.deleted, second.unchanged], [0, 0, 0, 2]);
  assert.equal(gateway.records.size, 2);
  assert.deepEqual(gateway.status, { status: 'success', locked_at: null, lock_id: null });
});

test('BULKY sync keeps its source identifier separate from the existing sheet tab and logs only safe range configuration', async () => {
  const messages = [];
  const gateway = statefulGateway();
  const env = { SHEET_ID_2026: 'spreadsheet-id', GOOGLE_CLIENT_EMAIL: 'secret@example.test' };
  await syncBulky(env, {
    gateway,
    fetchValues: async () => [HEADER, row('A')],
    logger: { log(message) { messages.push(message); }, error() {} },
  });

  assert.equal(BULKY_SHEET_NAME, 'stok bulky');
  assert.equal(messages[0], "[InventorySync:bulky]\nsheetName: stok bulky\nrange: 'stok bulky'!A:ZZ");
  assert.doesNotMatch(messages.join('\n'), /spreadsheet-id|secret@example\.test/);
});
