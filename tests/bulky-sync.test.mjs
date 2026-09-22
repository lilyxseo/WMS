import test from 'node:test';
import assert from 'node:assert/strict';
import { BULKY_SHEET_NAME, OPTIONAL_HEADERS, REQUIRED_HEADERS, buildSourceRowKey, normalizeBulkyHeader, parseBulkyValues, syncBulky } from '../functions/api/sync/inventory/_bulky-service.js';

const HEADER = [
  'LOKASI BULKY', 'SKU', 'NAMA BARANG', 'STOK AWAL', 'INTERNAL STOCK TRANSFER', 'REPLENISHMENT',
  'PENGELUARAN', 'STOK AKHIR', 'Netsuite',
];
const row = (sku, stokAkhir = '12', netsuite = '11') => [' bulky%20a ', sku, ` Produk ${sku} `, '10', '2', '3', '3', stokAkhir, netsuite];
const logger = { log() {}, error() {} };

function statefulGateway() {
  const records = new Map();
  const upsertedRows = [];
  const status = { status: null, locked_at: null, lock_id: null };
  return {
    records, status, upsertedRows,
    async acquireLock(source, lockId) { assert.equal(source, 'bulky'); status.status = 'syncing'; status.locked_at = new Date().toISOString(); status.lock_id = lockId; return true; },
    async insertHistory() { return 'history-1'; }, async updateHistory() {},
    async existingMetadata() { return [...records.values()].map(({ source_row_key, source_hash, iseller, netsuite, selisih, pendingan_it }) => ({ source_row_key, source_hash, iseller, netsuite, selisih, pendingan_it })); },
    async upsertRows(rows) { upsertedRows.push(...rows); rows.forEach(item => records.set(item.source_row_key, { ...records.get(item.source_row_key), ...item })); },
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

test('BULKY validates and maps every supported spelling of the Netsuite header through one canonical key', async () => {
  const variants = ['Netsuite', 'NETSUITE', 'netsuite', ' Net Suite ', 'Netsuite\u00a0', '\ufeffNetsuite'];
  assert.deepEqual(variants.map(normalizeBulkyHeader), variants.map(() => 'netsuite'));
  for (const header of variants) {
    const values = [[...HEADER.slice(0, -1), header], row(`SKU-${normalizeBulkyHeader(header)}`, '12', '10075')];
    const parsed = await parseBulkyValues(values);
    assert.equal(parsed.rows[0].netsuite, 10075);
    const result = await syncBulky({}, { gateway: statefulGateway(), fetchValues: async () => values, logger });
    assert.equal(result.success, true);
  }
});

test('BULKY detects a header below title and synchronizes without optional Netsuite', async () => {
  const messages = [];
  const values = [['LAPORAN STOK BULKY'], [], [HEADER[0], HEADER[1], HEADER[2], ...HEADER.slice(3, -1)], row('SKU-1')];
  const result = await syncBulky({}, { gateway: statefulGateway(), fetchValues: async () => values, logger: { log(message) { messages.push(message); }, error() {} } });
  assert.equal(result.success, true);
  assert.deepEqual(result.optionalHeaders, { iseller: false, netsuite: false, selisih: false, pendinganIt: false });
  const debug = JSON.parse(messages.find(message => message.startsWith('[BulkyHeaderDebug] ')).slice('[BulkyHeaderDebug] '.length));
  assert.equal(debug.sheetName, 'stok bulky');
  assert.equal(debug.range, "'stok bulky'!A:ZZ");
  assert.equal(debug.headerRow, 3);
  assert.equal(debug.optionalHeaders.netsuite, false);
  assert.deepEqual(debug.headerIndexes[0].characterCodes, [...HEADER[0]].map(character => character.codePointAt(0)));
  assert.doesNotMatch(JSON.stringify(debug), /SKU-1/);
});

test('BULKY keeps only core headers required and does not wipe optional database values when headers are absent', async () => {
  assert.deepEqual(REQUIRED_HEADERS, ['lokasibulky', 'sku', 'namabarang', 'stokawal', 'internalstocktransfer', 'replenishment', 'pengeluaran', 'stokakhir']);
  assert.deepEqual(OPTIONAL_HEADERS, ['iseller', 'netsuite', 'selisih', 'pendinganit']);
  const gateway = statefulGateway();
  const complete = await parseBulkyValues([HEADER, row('SKU-1', '12', '10075')]);
  gateway.records.set('bulky:2', { ...complete.rows[0], iseller: 'IS-1', selisih: 4, pendingan_it: 2 });

  const coreHeader = HEADER.slice(0, -1);
  const coreRow = row('SKU-1', '13').slice(0, -1);
  const result = await syncBulky({}, { gateway, fetchValues: async () => [coreHeader, coreRow], logger });

  assert.equal(result.success, true);
  assert.equal(gateway.records.get('bulky:2').stok_akhir, 13);
  assert.equal(['iseller', 'netsuite', 'selisih', 'pendingan_it'].some(field => Object.hasOwn(gateway.upsertedRows[0], field)), false);
  assert.deepEqual(
    Object.fromEntries(['iseller', 'netsuite', 'selisih', 'pendingan_it'].map(field => [field, gateway.records.get('bulky:2')[field]])),
    { iseller: 'IS-1', netsuite: 10075, selisih: 4, pendingan_it: 2 },
  );
});

test('BULKY parses and synchronizes every optional header when present', async () => {
  const optionalHeader = [...HEADER.slice(0, -1), 'ISELLER', 'netsuite', 'Selisih', 'Pendingan IT'];
  const optionalRow = [...row('SKU-OPTIONAL').slice(0, -1), 'IS-9', '42', '-3', '7'];
  const gateway = statefulGateway();
  const result = await syncBulky({}, { gateway, fetchValues: async () => [optionalHeader, optionalRow], logger });
  assert.deepEqual(result.optionalHeaders, { iseller: true, netsuite: true, selisih: true, pendinganIt: true });
  assert.deepEqual(
    Object.fromEntries(['iseller', 'netsuite', 'selisih', 'pendingan_it'].map(field => [field, gateway.records.get('bulky:2')[field]])),
    { iseller: 'IS-9', netsuite: 42, selisih: -3, pendingan_it: 7 },
  );
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
