import test from 'node:test';
import assert from 'node:assert/strict';
import { BARANG_KELUAR_SHEET_NAME, BARANG_KELUAR_SHEET_RANGE, buildSourceRowKey, fetchBarangKeluarValues, parseBarangKeluarValues, syncBarangKeluar } from '../functions/api/sync/inventory/_barang-keluar-service.js';

const HEADER = ['TANGGAL', 'FROM', 'TO', 'SKU', 'NAMABARANG', 'QTY', 'STATUS', 'PIC', 'KETERANGAN', 'NO ISELLER', 'NETSUITE', 'KETERANGAN LAINNYA', 'STATUS', 'LOKASI SURAT JALAN', 'NO ISELLER AWAL', 'DOKUMEN'];
const row = (sku, qty = '10', extra = {}) => ['2026-08-30', ' outbound ', ' store%20-01 ', sku, `Produk ${sku}`, qty, 'Sent', 'Abi', 'Baik', extra.no_iseller ?? 'IS-1', extra.netsuite ?? '00042', extra.keterangan_lainnya ?? 'Fragile', extra.status_lanjutan ?? 'Closed', extra.lokasi_surat_jalan ?? 'Archive A', extra.no_iseller_awal ?? 'IS-0', extra.dokumen ?? 'https://docs.example/1'];
const logger = { log() {}, error() {} };

function statefulGateway() {
  const records = new Map();
  const status = { source: 'barang_keluar', status: null, locked_at: null, lock_id: null };
  return {
    records, status,
    async acquireLock(source, lockId) { assert.equal(source, 'barang_keluar'); status.status = 'syncing'; status.locked_at = new Date().toISOString(); status.lock_id = lockId; return true; },
    async insertHistory() { return 'history-1'; }, async updateHistory() {},
    async existingMetadata() { return [...records.values()].map(({ source_row_key, source_hash, no_iseller, netsuite, keterangan_lainnya, status_lanjutan, lokasi_surat_jalan, no_iseller_awal, dokumen }) => ({ source_row_key, source_hash, no_iseller, netsuite, keterangan_lainnya, status_lanjutan, lokasi_surat_jalan, no_iseller_awal, dokumen })); },
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
    no_iseller: 'IS-1', netsuite: '00042', keterangan_lainnya: 'Fragile', status_lanjutan: 'Closed', lokasi_surat_jalan: 'Archive A', no_iseller_awal: 'IS-0', dokumen: 'https://docs.example/1',
    source_hash: parsed.rows[0].source_hash,
  });
  assert.match(parsed.rows[0].source_hash, /^[a-f0-9]{64}$/);
});

test('Barang Keluar maps the first and second STATUS columns independently', async () => {
  const parsed = await parseBarangKeluarValues([HEADER, row('SKU-DUPLICATE-STATUS')]);
  assert.equal(parsed.rows[0].status, 'Sent');
  assert.equal(parsed.rows[0].status_lanjutan, 'Closed');
});

test('Barang Keluar fetches all 16 columns through DOKUMEN', async () => {
  let requestedUrl = '';
  await fetchBarangKeluarValues({ SHEET_ID_2026: 'sheet' }, { getGoogleAccessToken: async () => 'token', fetch: async url => { requestedUrl = String(url); return new Response(JSON.stringify({ values: [HEADER] })); } });
  assert.equal(BARANG_KELUAR_SHEET_RANGE, "'Barang KeIuar'!A:P");
  assert.equal(decodeURIComponent(requestedUrl).includes("'Barang KeIuar'!A:P"), true);
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

test('new values backfill legacy rows, affect source_hash, and remain idempotent', async () => {
  const gateway = statefulGateway();
  const values = [HEADER, row('SKU-BACKFILL')];
  await syncBarangKeluar({}, { gateway, fetchValues: async () => values, logger });
  const original = gateway.records.get('barang_keluar:2');
  gateway.records.set('barang_keluar:2', { ...original, no_iseller: null, source_hash: original.source_hash });
  const backfill = await syncBarangKeluar({}, { gateway, fetchValues: async () => values, logger });
  assert.equal(backfill.updated, 1);
  const changed = [HEADER, row('SKU-BACKFILL', '10', { dokumen: 'https://docs.example/2' })];
  const update = await syncBarangKeluar({}, { gateway, fetchValues: async () => changed, logger });
  assert.equal(update.updated, 1);
  assert.notEqual(gateway.records.get('barang_keluar:2').source_hash, original.source_hash);
  const unchanged = await syncBarangKeluar({}, { gateway, fetchValues: async () => changed, logger });
  assert.deepEqual([unchanged.updated, unchanged.unchanged], [0, 1]);
});
