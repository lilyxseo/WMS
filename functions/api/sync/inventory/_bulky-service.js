import { createInventorySyncService, normalizeLocation, normalizeNumber, normalizeSku, normalizeText, normalizedHeader, SyncError } from './_sync-engine.js';

export const SYNC_SOURCE = 'bulky';
// Keep the internal source identifier separate from the Google Sheets tab name.
export const BULKY_SHEET_NAME = 'stok bulky';
export const REQUIRED_HEADERS = Object.freeze([
  'LOKASI BULKY', 'SKU', 'NAMA BARANG', 'STOK AWAL', 'INTERNAL STOCK TRANSFER', 'REPLENISHMENT',
  'PENGELUARAN', 'STOK AKHIR', 'NETSUITE',
]);

const NUMBER_FIELDS = Object.freeze([
  ['STOK AWAL', 'stok_awal'],
  ['INTERNAL STOCK TRANSFER', 'internal_stock_transfer'],
  ['REPLENISHMENT', 'replenishment'],
  ['PENGELUARAN', 'pengeluaran'],
  ['STOK AKHIR', 'stok_akhir'],
  ['NETSUITE', 'netsuite'],
]);

async function parseValues(values, helpers) {
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw new SyncError('INVALID_HEADER', 'Header BULKY tidak ditemukan');
  const indexes = new Map(values[0].map((header, index) => [normalizedHeader(header), index]));
  const missing = REQUIRED_HEADERS.filter(header => !indexes.has(header));
  if (missing.length) throw new SyncError('INVALID_HEADER', `Header wajib tidak ditemukan: ${missing.join(', ')}`);

  const rows = [], invalidRows = [], sourceKeys = new Set(); let sourceRowCount = 0;
  for (let index = 1; index < values.length; index += 1) {
    const cells = Array.isArray(values[index]) ? values[index] : [], sourceRowNumber = index + 1, read = header => cells[indexes.get(header)];
    if (REQUIRED_HEADERS.every(header => normalizeText(read(header)) === '')) continue;
    sourceRowCount += 1;
    const source_row_key = helpers.buildSourceRowKey(sourceRowNumber); sourceKeys.add(source_row_key);
    const numbers = Object.fromEntries(NUMBER_FIELDS.map(([header, field]) => [field, normalizeNumber(read(header))]));
    const row = {
      lokasi_bulky: normalizeLocation(read('LOKASI BULKY')),
      sku: normalizeSku(read('SKU')),
      nama_barang: normalizeText(read('NAMA BARANG')),
      ...Object.fromEntries(NUMBER_FIELDS.map(([, field]) => [field, numbers[field].value])),
      source_row_key,
      source_row_number: sourceRowNumber,
    };
    const errors = [];
    if (!row.sku) errors.push('SKU_REQUIRED');
    for (const [header, field] of NUMBER_FIELDS) if (!numbers[field].valid) errors.push(`INVALID_NUMBER:${header}`);
    if (errors.length) { invalidRows.push({ sourceRowNumber, sourceRowKey: source_row_key, errors }); continue; }
    row.source_hash = await helpers.buildSourceHash(row); rows.push(row);
  }
  return { rows, invalidRows, sourceKeys, sourceRowCount };
}

const service = createInventorySyncService({
  source: SYNC_SOURCE,
  sheetName: BULKY_SHEET_NAME,
  tableName: 'inventory_bulky',
  parseValues,
  hashFields: [
    'lokasi_bulky', 'sku', 'nama_barang', 'stok_awal', 'internal_stock_transfer', 'replenishment',
    'pengeluaran', 'stok_akhir', 'netsuite',
  ],
  metadataFields: ['netsuite'],
  needsUpdate: (existing, row) => existing.netsuite == null && row.netsuite != null,
  buildMetrics({ parsed, existing, diff }) {
    const existingByKey = new Map(existing.map(row => [row.source_row_key, row]));
    const isBackfill = row => existingByKey.get(row.source_row_key)?.netsuite == null && row.netsuite != null;
    return {
      netsuiteSourceValues: parsed.rows.filter(row => row.netsuite != null).length,
      netsuiteBackfilledRows: diff.rowsToUpdate.filter(isBackfill).length,
      nullNetsuiteRows: parsed.rows.filter(row => row.netsuite == null).length,
      invalidNetsuiteValues: parsed.invalidRows.filter(row => row.errors.includes('INVALID_NUMBER:NETSUITE')).length,
    };
  },
});

export const buildSourceRowKey = service.buildSourceRowKey;
export const buildSourceHash = service.buildSourceHash;
export const fetchBulkyValues = service.fetchValues;
export function syncBulky(env, dependencies = {}) {
  const logger = dependencies.logger || console;
  const range = `'${BULKY_SHEET_NAME}'!A:ZZ`;
  (logger?.log || console.log)(
    `[InventorySync:${SYNC_SOURCE}]\n` +
    `sheetName: ${BULKY_SHEET_NAME}\n` +
    `range: ${range}`,
  );
  return service.sync(env, dependencies);
}
export function parseBulkyValues(values) { return parseValues(values, service); }
