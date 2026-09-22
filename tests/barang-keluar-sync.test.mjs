import test from 'node:test';
import assert from 'node:assert/strict';
import { BARANG_KELUAR_SHEET_NAME, buildSourceRowKey, parseBarangKeluarValues, syncBarangKeluar } from '../functions/api/sync/inventory/_barang-keluar-service.js';

const HEADER = ['TANGGAL', 'FROM', 'TO', 'SKU', 'NAMABARANG', 'QTY', 'STATUS', 'PIC', 'KETERANGAN'];
const row = (sku, qty = '10') => ['2026-08-30', ' outbound ', ' store%20-01 ', sku, `Produk ${sku}`, qty, 'Sent', 'Abi', 'Baik'];
const logger = { log() {}, error() {} };

function statefulGateway() {
  const records = new Map();
  const status = { source: 'barang_keluar', status: null, locked_at: null, lock_id: null };
  return {
    records, status,
    async acquireLock(source, lockId) { assert.equal(source, 'barang_keluar'); status.status = 'syncing'; status.locked_at = new Date().toISOString(); status.lock_id = lockId; return true; },
    async insertHistory() { return 'history-1'; }, async updateHistory() {},
    async existingMetadata() { return [...records.values()].map(({ source_row_key, source_hash }) => ({ source_row_key, source_hash })); },
    async upsertRows(rows) { rows.forEach(item => records.set(item.source_row_key, item)); },
    async deleteKeys(keys) { keys.forEach(key => records.delete(key)); },
    async finishSuccess(args) { assert.equal(args.source, 'barang_keluar'); status.status = 'success'; status.locked_at = null; status.lock_id = null; },
    async finishError() {},
  };
}

test('Barang Keluar maps its existing sheet and required columns with shared normalization', async () => {
  const parsed = await parseBarangKeluarValues([HEADER.map(item => ` ${item.toLowerCase()} `), row('SKU–1')]);
  assert.equal(BARANG_KELUAR_SHEET_NAME, 'Barang KeIuar');
  assert.equal(buildSourceRowKey(2), 'barang_keluar:2');
  assert.deepEqual(parsed.rows[0], {
    tanggal: '2026-08-30', from_location: 'OUTBOUND', to_location: 'STORE -01', sku: 'SKU-1', nama_barang: 'Produk SKU–1',
    qty: 10, status: 'Sent', pic: 'Abi', keterangan: 'Baik', source_row_key: 'barang_keluar:2', source_row_number: 2,
    source_hash: parsed.rows[0].source_hash,
  });
  assert.match(parsed.rows[0].source_hash, /^[a-f0-9]{64}$/);
});

test('Barang Keluar uses the leftmost STATUS column when the sheet has duplicate headers', async () => {
  const duplicateStatusHeader = [...HEADER, 'STATUS'];
  const duplicateStatusRow = [...row('SKU-DUPLICATE-STATUS'), 'Status dari kolom kedua'];
  const parsed = await parseBarangKeluarValues([duplicateStatusHeader, duplicateStatusRow]);

  assert.equal(parsed.rows[0].status, 'Sent');
});

test('Barang Keluar validates headers and preserves invalid source identities', async () => {
  await assert.rejects(() => parseBarangKeluarValues([HEADER.slice(0, -1)]), error => error.code === 'INVALID_HEADER');
  const parsed = await parseBarangKeluarValues([HEADER, row('', '#VALUE!')]);
  assert.deepEqual(parsed.invalidRows[0].errors, ['SKU_REQUIRED', 'INVALID_NUMBER:QTY']);
  assert.equal(parsed.sourceKeys.has('barang_keluar:2'), true);
});

test('Barang Keluar normalizes empty and supported dates and diagnoses invalid non-empty dates', async () => {
  const withDate = tanggal => { const values = row('SKU-DATE'); values[0] = tanggal; return values; };
  for (const empty of [null, undefined, '', '   ']) {
    const parsed = await parseBarangKeluarValues([HEADER, withDate(empty)]);
    assert.equal(parsed.rows[0].tanggal, null);
    assert.deepEqual(parsed.invalidRows, []);
  }
  assert.equal((await parseBarangKeluarValues([HEADER, withDate('8/30/2026')])).rows[0].tanggal, '2026-08-30');
  assert.equal((await parseBarangKeluarValues([HEADER, withDate('2026-08-30')])).rows[0].tanggal, '2026-08-30');
  const invalid = await parseBarangKeluarValues([HEADER, withDate('2026-02-30')]);
  assert.equal(invalid.rows.length, 0);
  assert.deepEqual(invalid.invalidRows[0].errors, ['INVALID_DATE:TANGGAL']);
});

test('first sync, second sync, and status use the reusable engine semantics', async () => {
  const gateway = statefulGateway();
  const values = [HEADER, ...Array.from({ length: 2000 }, (_, index) => row(`SKU-${index + 1}`))];
  const run = () => syncBarangKeluar({}, { gateway, fetchValues: async () => values, logger });
  const first = await run();
  assert.equal(first.success, true);
  assert.deepEqual([first.inserted, first.updated, first.deleted, gateway.records.size], [2000, 0, 0, 2000]);
  const second = await run();
  assert.deepEqual([second.inserted, second.updated, second.deleted, second.unchanged], [0, 0, 0, 2000]);
  assert.deepEqual(gateway.status, { source: 'barang_keluar', status: 'success', locked_at: null, lock_id: null });
});
