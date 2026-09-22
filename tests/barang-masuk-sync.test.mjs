import test from 'node:test';
import assert from 'node:assert/strict';
import { BARANG_MASUK_SHEET_RANGE, buildSourceRowKey, fetchBarangMasukValues, parseBarangMasukValues, syncBarangMasuk } from '../functions/api/sync/inventory/_barang-masuk-service.js';

const HEADER = ['TANGGAL', 'FROM', 'TO', 'SKU', 'NAMA BARANG', 'QTY', 'STATUS', 'PIC', 'KETERANGAN', 'NO ISELLER', 'NETSUITE', 'KETERANGAN LAINNYA', 'LOKASI SURAT JALAN', 'STOCKOUT', 'DOKUMEN'];
const row = (sku, qty = '10', extra = {}) => ['2026-08-30', ' inbound ', ' a%20-01 ', sku, `Produk ${sku}`, qty, 'Received', 'Abi', 'Baik', extra.no_iseller ?? 'IS-001', extra.netsuite ?? '00042', extra.keterangan_lainnya ?? 'Fragile', extra.lokasi_surat_jalan ?? 'Archive A', extra.stockout ?? 'Pending', extra.dokumen ?? 'https://docs.example/sj/1'];
const logger = { log() {}, error() {} };

function statefulGateway() {
  const records = new Map();
  return {
    records,
    async acquireLock(source) { assert.equal(source, 'barang_masuk'); return true; },
    async insertHistory() { return 'history-1'; }, async updateHistory() {},
    async existingMetadata() { return [...records.values()].map(({ source_row_key, source_hash, no_iseller, netsuite, keterangan_lainnya, lokasi_surat_jalan, stockout, dokumen }) => ({ source_row_key, source_hash, no_iseller, netsuite, keterangan_lainnya, lokasi_surat_jalan, stockout, dokumen })); },
    async upsertRows(rows) { rows.forEach(item => records.set(item.source_row_key, item)); },
    async deleteKeys(keys) { keys.forEach(key => records.delete(key)); },
    async finishSuccess(args) { assert.equal(args.source, 'barang_masuk'); }, async finishError() {},
  };
}

test('Barang Masuk maps headers, normalizes values, and retains original sheet identity', async () => {
  const parsed = await parseBarangMasukValues([HEADER.map(item => ` ${item.toLowerCase()} `), row('SKU–1'), [], row('SKU-2')]);
  assert.equal(buildSourceRowKey(2), 'barang_masuk:2');
  assert.deepEqual(parsed.rows.map(item => item.source_row_key), ['barang_masuk:2', 'barang_masuk:4']);
  assert.deepEqual(parsed.rows[0], {
    tanggal: '2026-08-30', from_location: 'INBOUND', to_location: 'A -01', sku: 'SKU-1', nama_barang: 'Produk SKU–1',
    qty: 10, status: 'Received', pic: 'Abi', keterangan: 'Baik', no_iseller: 'IS-001', netsuite: '00042',
    keterangan_lainnya: 'Fragile', lokasi_surat_jalan: 'Archive A', stockout: 'Pending', dokumen: 'https://docs.example/sj/1', source_row_key: 'barang_masuk:2', source_row_number: 2,
    source_hash: parsed.rows[0].source_hash,
  });
  assert.match(parsed.rows[0].source_hash, /^[a-f0-9]{64}$/);
});

test('Barang Masuk reads the detected 15-column header range through DOKUMEN', async () => {
  let requestedUrl = '';
  const values = [HEADER, row('SKU-RANGE')];
  const result = await fetchBarangMasukValues({ SHEET_ID_2026: 'sheet' }, {
    getGoogleAccessToken: async () => 'token',
    fetch: async url => { requestedUrl = String(url); return { ok: true, status: 200, json: async () => ({ values }) }; },
  });
  assert.deepEqual(result[0], HEADER);
  assert.equal(BARANG_MASUK_SHEET_RANGE, "'Barang Masuk'!A:O");
  assert.equal(decodeURIComponent(new URL(requestedUrl).pathname.split('/').at(-1)), "'Barang Masuk'!A:O");
});

test('each added field participates in source_hash', async () => {
  const base = (await parseBarangMasukValues([HEADER, row('HASH')])).rows[0].source_hash;
  for (const field of ['no_iseller', 'netsuite', 'keterangan_lainnya', 'lokasi_surat_jalan', 'stockout', 'dokumen']) {
    const changed = (await parseBarangMasukValues([HEADER, row('HASH', '10', { [field]: `changed-${field}` })])).rows[0].source_hash;
    assert.notEqual(changed, base, field);
  }
});

test('first deployment sync backfills missing business fields and the second sync is idempotent', async () => {
  const gateway = statefulGateway();
  const values = [HEADER, row('BACKFILL')];
  const parsed = await parseBarangMasukValues(values);
  gateway.records.set('barang_masuk:2', { source_row_key: 'barang_masuk:2', source_hash: parsed.rows[0].source_hash });
  const run = () => syncBarangMasuk({}, { gateway, fetchValues: async () => values, logger });
  const first = await run();
  assert.deepEqual([first.updated, first.unchanged], [1, 0]);
  assert.equal(gateway.records.get('barang_masuk:2').dokumen, 'https://docs.example/sj/1');
  const second = await run();
  assert.deepEqual([second.updated, second.unchanged], [0, 1]);
});

test('Barang Masuk rejects missing headers and diagnoses invalid rows without deleting their identity', async () => {
  await assert.rejects(() => parseBarangMasukValues([HEADER.slice(0, -1)]), error => error.code === 'INVALID_HEADER');
  const parsed = await parseBarangMasukValues([HEADER, row('', '#VALUE!')]);
  assert.deepEqual(parsed.invalidRows[0].errors, ['SKU_REQUIRED', 'INVALID_NUMBER:QTY']);
  assert.equal(parsed.sourceKeys.has('barang_masuk:2'), true);
});

test('Barang Masuk uses the shared date normalization without rejecting empty dates', async () => {
  const withDate = tanggal => { const values = row('SKU-DATE'); values[0] = tanggal; return values; };
  assert.equal((await parseBarangMasukValues([HEADER, withDate('')])).rows[0].tanggal, null);
  assert.equal((await parseBarangMasukValues([HEADER, withDate('   ')])).rows[0].tanggal, null);
  assert.equal((await parseBarangMasukValues([HEADER, withDate('8/30/2026')])).rows[0].tanggal, '2026-08-30');
  const invalid = await parseBarangMasukValues([HEADER, withDate('not-a-date')]);
  assert.deepEqual(invalid.invalidRows[0].errors, ['INVALID_DATE:TANGGAL']);
});

test('Barang Masuk sync covers empty DB, idempotency, one update, one insert, and one delete', async () => {
  const gateway = statefulGateway();
  const run = values => syncBarangMasuk({}, { gateway, fetchValues: async () => values, logger });
  const initial = [HEADER, row('A'), row('B')];
  let result = await run(initial);
  assert.deepEqual([result.inserted, result.updated, result.deleted], [2, 0, 0]);
  result = await run(initial);
  assert.deepEqual([result.inserted, result.updated, result.deleted, result.unchanged], [0, 0, 0, 2]);
  result = await run([HEADER, row('A', '11'), row('B')]);
  assert.deepEqual([result.inserted, result.updated, result.deleted], [0, 1, 0]);
  result = await run([HEADER, row('A', '11'), row('B'), row('C')]);
  assert.deepEqual([result.inserted, result.updated, result.deleted], [1, 0, 0]);
  result = await run([HEADER, row('A', '11'), row('C')]);
  assert.deepEqual([result.inserted, result.updated, result.deleted], [0, 1, 1]);
});

test('7000-row sync uses paged metadata and 1000-row mutation batches', async () => {
  const records = new Map();
  const calls = { google: 0, reads: 0, upserts: 0, history: 0, rpc: 0 };
  const values = [HEADER, ...Array.from({ length: 7000 }, (_, index) => row(`SKU-${index + 1}`))];
  const fetch = async (url, options = {}) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === 'oauth2.googleapis.com') {
      calls.google += 1;
      return { ok: true, status: 200, json: async () => ({ access_token: 'token' }) };
    }
    if (parsedUrl.hostname === 'sheets.googleapis.com') {
      calls.google += 1;
      return { ok: true, status: 200, json: async () => ({ values }) };
    }
    const path = parsedUrl.pathname;
    if (path.includes('/rpc/')) {
      calls.rpc += 1;
      return { ok: true, status: 200, json: async () => path.endsWith('/acquire_inventory_sync_lock') ? true : null };
    }
    if (path.endsWith('/inventory_sync_history')) {
      calls.history += 1;
      return options.method === 'POST'
        ? { ok: true, status: 201, json: async () => [{ id: 'history-1' }] }
        : { ok: true, status: 204, json: async () => null };
    }
    if (path.endsWith('/inventory_barang_masuk') && !options.method) {
      calls.reads += 1;
      const offset = Number(parsedUrl.searchParams.get('offset'));
      const page = [...records.values()].slice(offset, offset + 1000).map(({ source_row_key, source_hash, no_iseller, netsuite, keterangan_lainnya, lokasi_surat_jalan, stockout, dokumen }) => ({ source_row_key, source_hash, no_iseller, netsuite, keterangan_lainnya, lokasi_surat_jalan, stockout, dokumen }));
      return { ok: true, status: 200, json: async () => page };
    }
    if (path.endsWith('/inventory_barang_masuk') && options.method === 'POST') {
      calls.upserts += 1;
      JSON.parse(options.body).forEach(item => records.set(item.source_row_key, item));
      return { ok: true, status: 201, json: async () => null };
    }
    return { ok: true, status: 204, json: async () => null };
  };
  const env = { SHEET_ID_2026: 'sheet', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' };
  const dependencies = { fetch, getGoogleAccessToken: async () => { calls.google += 1; return 'token'; }, logger };

  const first = await syncBarangMasuk(env, dependencies);
  assert.deepEqual([first.inserted, first.updated, first.deleted, first.unchanged], [7000, 0, 0, 0]);
  assert.deepEqual(first.requests, { googleRequests: 2, supabaseReads: 1, supabaseWrites: 9, rpcRequests: 2, estimatedRequests: 14 });
  assert.equal(calls.upserts, 7);
  assert.ok(first.requests.estimatedRequests < 50);

  calls.google = calls.reads = calls.upserts = calls.history = calls.rpc = 0;
  const second = await syncBarangMasuk(env, dependencies);
  assert.deepEqual([second.inserted, second.updated, second.deleted, second.unchanged], [0, 0, 0, 7000]);
  assert.deepEqual(second.requests, { googleRequests: 2, supabaseReads: 8, supabaseWrites: 2, rpcRequests: 2, estimatedRequests: 14 });
  assert.equal(calls.upserts, 0);
  assert.ok(second.requests.estimatedRequests < 15);
});
