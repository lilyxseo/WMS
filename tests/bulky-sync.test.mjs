import test from 'node:test';
import assert from 'node:assert/strict';
import { BULKY_SHEET_NAME, buildSourceRowKey, parseBulkyValues, syncBulky } from '../functions/api/sync/inventory/_bulky-service.js';

const HEADER = [
  'LOKASI BULKY', 'SKU', 'NAMA BARANG', 'STOK AWAL', 'INTERNAL STOCK TRANSFER', 'REPLENISHMENT',
  'PENGELUARAN', 'STOK AKHIR', 'NETSUITE',
];
const row = (sku, stokAkhir = '12', netsuite = '10,081') => [' bulky%20a ', sku, ` Produk ${sku} `, '10', '2', '3', '3', stokAkhir, netsuite];
const logger = { log() {}, error() {} };

function statefulGateway() {
  const records = new Map();
  const status = { status: null, locked_at: null, lock_id: null };
  return {
    records, status,
    async acquireLock(source, lockId) { assert.equal(source, 'bulky'); status.status = 'syncing'; status.locked_at = new Date().toISOString(); status.lock_id = lockId; return true; },
    async insertHistory() { return 'history-1'; }, async updateHistory() {},
    async existingMetadata() { return [...records.values()].map(({ source_row_key, source_hash }) => ({ source_row_key, source_hash })); },
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
    internal_stock_transfer: 2, replenishment: 3, pengeluaran: 3, stok_akhir: 12,
    netsuite: 10081,
    source_row_key: 'bulky:2', source_row_number: 2, source_hash: parsed.rows[0].source_hash,
  });
  assert.match(parsed.rows[0].source_hash, /^[a-f0-9]{64}$/);
});

test('BULKY NETSUITE is nullable, numeric, diagnostic, and part of source_hash', async () => {
  const populated = await parseBulkyValues([HEADER, row('SKU-1', '12', '100')]);
  const comma = await parseBulkyValues([HEADER, row('SKU-1', '12', '10,081')]);
  const normalizedComma = await parseBulkyValues([HEADER, row('SKU-1', '12', '10081')]);
  const blank = await parseBulkyValues([HEADER, row('SKU-1', '12', '')]);
  const changed = await parseBulkyValues([HEADER, row('SKU-1', '12', '120')]);
  assert.equal(populated.rows[0].netsuite, 100);
  assert.equal(comma.rows[0].netsuite, 10081);
  assert.equal(blank.rows[0].netsuite, null);
  assert.equal(comma.rows[0].source_hash, normalizedComma.rows[0].source_hash);
  assert.notEqual(populated.rows[0].source_hash, changed.rows[0].source_hash);

  const invalid = await parseBulkyValues([HEADER, row('SKU-1', '12', 'invalid')]);
  assert.deepEqual(invalid.invalidRows[0].errors, ['INVALID_NUMBER:NETSUITE']);
  assert.deepEqual(invalid.reportMetrics, { nullNetsuiteRows: 0, invalidNetsuiteValues: 1 });
});

test('BULKY validates headers and reports invalid numeric cells without coercing them to zero', async () => {
  await assert.rejects(() => parseBulkyValues([HEADER.slice(1)]), error => error.code === 'INVALID_HEADER');
  const invalid = row('SKU-1'); invalid[3] = '#VALUE!'; invalid[7] = 'not-a-number';
  const parsed = await parseBulkyValues([HEADER, invalid]);
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.invalidRows, [{ sourceRowNumber: 2, sourceRowKey: 'bulky:2', errors: ['INVALID_NUMBER:STOK AWAL', 'INVALID_NUMBER:STOK AKHIR'] }]);
  assert.equal(parsed.sourceKeys.has('bulky:2'), true);
});

test('BULKY first and unchanged second sync preserve valid database count and release status lock', async () => {
  const gateway = statefulGateway();
  const values = [HEADER, row('A'), row('B'), [...row('INVALID')].map((value, index) => index === 6 ? 'invalid' : value)];
  const run = () => syncBulky({}, { gateway, fetchValues: async () => values, logger });

  const first = await run();
  assert.deepEqual([first.success, first.sourceRows, first.invalidRows, first.inserted, first.updated, first.deleted], [true, 3, 1, 2, 0, 0]);
  assert.equal(gateway.records.size, 2);
  assert.deepEqual(gateway.status, { status: 'success', locked_at: null, lock_id: null });
  assert.deepEqual([first.nullNetsuiteRows, first.invalidNetsuiteValues], [0, 0]);

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
