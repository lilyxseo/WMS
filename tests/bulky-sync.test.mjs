import test from 'node:test';
import assert from 'node:assert/strict';
import { BULKY_SHEET_NAME, BULKY_SHEET_RANGE, buildSourceRowKey, normalizeBulkyHeader, parseBulkyValues, syncBulky } from '../functions/api/sync/inventory/_bulky-service.js';

const HEADER = [
  'LOKASI BULKY', 'SKU', 'NAMA BARANG', 'STOK AWAL', 'INTERNAL STOCK TRANSFER', 'REPLENISHMENT',
  'PENGELUARAN', 'STOK AKHIR', 'Iseller', 'Netsuite', 'Selisih', 'Pendingan IT',
];
const row = (sku, stokAkhir = '12', values = {}) => [' bulky%20a ', sku, ` Produk ${sku} `, '10', '2', '3', '3', stokAkhir, values.iseller ?? '12', values.netsuite ?? '11', values.selisih ?? '1', values.pendingan_it ?? '2'];
const logger = { log() {}, error() {} };

function statefulGateway() {
  const records = new Map();
  const status = { status: null, locked_at: null, lock_id: null };
  return {
    records, status,
    async acquireLock(source, lockId) { assert.equal(source, 'bulky'); status.status = 'syncing'; status.locked_at = new Date().toISOString(); status.lock_id = lockId; return true; },
    async insertHistory() { return 'history-1'; }, async updateHistory() {},
    async existingMetadata() { return [...records.values()].map(({ source_row_key, source_hash, iseller, netsuite, selisih, pendingan_it }) => ({ source_row_key, source_hash, iseller, netsuite, selisih, pendingan_it })); },
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
    internal_stock_transfer: 2, replenishment: 3, pengeluaran: 3, stok_akhir: 12, iseller: 12, netsuite: 11, selisih: 1, pendingan_it: 2,
    source_row_key: 'bulky:2', source_row_number: 2, source_hash: parsed.rows[0].source_hash,
  });
  assert.match(parsed.rows[0].source_hash, /^[a-f0-9]{64}$/);
});

test('BULKY detects every new header case-insensitively through canonical keys', async () => {
  for (const index of [8, 9, 10, 11]) {
    for (const spelling of [HEADER[index], HEADER[index].toUpperCase(), HEADER[index].toLowerCase()]) {
      const headers = [...HEADER]; headers[index] = spelling;
      const parsed = await parseBulkyValues([headers, row(`SKU-${index}`)]);
      assert.equal(parsed.rows.length, 1);
    }
  }
  assert.equal(normalizeBulkyHeader(' Pendingan IT '), 'pendinganit');
});

test('BULKY detects a header below title and empty rows and reports safe header-only diagnostics', async () => {
  const messages = [];
  const values = [['LAPORAN STOK BULKY'], [], HEADER.slice(0, -1), row('SKU-1')];
  await assert.rejects(
    () => syncBulky({}, { gateway: statefulGateway(), fetchValues: async () => values, logger: { log(message) { messages.push(message); }, error() {} } }),
    error => {
      assert.equal(error.code, 'INVALID_HEADER');
      assert.equal(error.missingHeader, 'Pendingan IT');
      assert.equal(error.headerRowNumber, 3);
      assert.deepEqual(error.detectedHeaders, values[2]);
      assert.deepEqual(error.normalizedHeaders.slice(0, 3), ['lokasibulky', 'sku', 'namabarang']);
      return true;
    },
  );
  const debug = JSON.parse(messages.find(message => message.startsWith('[BulkyHeaderDebug] ')).slice('[BulkyHeaderDebug] '.length));
  assert.equal(debug.sheetName, 'stok bulky');
  assert.equal(debug.range, "'stok bulky'!A:L");
  assert.equal(debug.headerRow, 3);
  assert.deepEqual(debug.expectedBusinessHeaders, ['iseller', 'netsuite', 'selisih', 'pendinganit']);
  assert.deepEqual(debug.headerIndexes[0].characterCodes, [...HEADER[0]].map(character => character.codePointAt(0)));
  assert.doesNotMatch(JSON.stringify(debug), /SKU-1/);
});

test('BULKY validates headers and reports invalid numeric cells without coercing them to zero', async () => {
  await assert.rejects(() => parseBulkyValues([HEADER.slice(1)]), error => error.code === 'INVALID_HEADER');
  const invalid = row('SKU-1'); invalid[3] = '#VALUE!'; invalid[7] = 'not-a-number'; invalid[8] = 'invalid-iseller'; invalid[9] = 'invalid-netsuite'; invalid[10] = 'invalid-selisih'; invalid[11] = 'invalid-pending';
  const parsed = await parseBulkyValues([HEADER, invalid]);
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.invalidRows, [{ sourceRowNumber: 2, sourceRowKey: 'bulky:2', errors: ['INVALID_NUMBER:STOK AWAL', 'INVALID_NUMBER:STOK AKHIR', 'INVALID_NUMBER:ISELLER', 'INVALID_NUMBER:NETSUITE', 'INVALID_NUMBER:SELISIH', 'INVALID_NUMBER:PENDINGAN IT'] }]);
  assert.equal(parsed.sourceKeys.has('bulky:2'), true);
});

test('BULKY backfills every newly synchronized field once and reports diagnostics', async () => {
  const gateway = statefulGateway();
  const values = [HEADER, row('BACKFILL'), row('BLANK', '8', { iseller: '', netsuite: '', selisih: '', pendingan_it: '' }), row('INVALID', '6', { iseller: 'bad' })];
  const source = await parseBulkyValues(values);
  gateway.records.set('bulky:2', { ...source.rows[0], iseller: null, netsuite: null, selisih: null, pendingan_it: null, source_hash: source.rows[0].source_hash });
  const run = () => syncBulky({}, { gateway, fetchValues: async () => values, logger });
  const first = await run();
  assert.deepEqual({ updated: first.updated, backfilledRows: first.backfilledRows, nullIsellerRows: first.nullIsellerRows, nullNetsuiteRows: first.nullNetsuiteRows, nullSelisihRows: first.nullSelisihRows, nullPendinganItRows: first.nullPendinganItRows, invalidNumericValues: first.invalidNumericValues }, { updated: 1, backfilledRows: 1, nullIsellerRows: 1, nullNetsuiteRows: 1, nullSelisihRows: 1, nullPendinganItRows: 1, invalidNumericValues: 1 });
  assert.deepEqual([gateway.records.get('bulky:2').iseller, gateway.records.get('bulky:2').netsuite, gateway.records.get('bulky:2').selisih, gateway.records.get('bulky:2').pendingan_it], [12, 11, 1, 2]);
  const second = await run();
  assert.deepEqual([second.inserted, second.updated, second.unchanged, second.backfilledRows], [0, 0, 2, 0]);
});

test('each added BULKY field participates in source_hash', async () => {
  const base = (await parseBulkyValues([HEADER, row('HASH')])).rows[0].source_hash;
  for (const field of ['iseller', 'netsuite', 'selisih', 'pendingan_it']) {
    const changed = (await parseBulkyValues([HEADER, row('HASH', '12', { [field]: '99' })])).rows[0].source_hash;
    assert.notEqual(changed, base, field);
  }
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
  assert.equal(BULKY_SHEET_RANGE, "'stok bulky'!A:L");
  assert.equal(messages[0], "[InventorySync:bulky]\nsheetName: stok bulky\nrange: 'stok bulky'!A:L");
  assert.doesNotMatch(messages.join('\n'), /spreadsheet-id|secret@example\.test/);
});
