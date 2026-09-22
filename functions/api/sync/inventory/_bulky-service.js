import { createInventorySyncService, normalizeLocation, normalizeNumber, normalizeSku, normalizeText, SyncError } from './_sync-engine.js';

export const SYNC_SOURCE = 'bulky';
// Keep the internal source identifier separate from the Google Sheets tab name.
export const BULKY_SHEET_NAME = 'stok bulky';
export const BULKY_SHEET_RANGE = `'${BULKY_SHEET_NAME}'!A:L`;
export function normalizeBulkyHeader(value) {
  return normalizeText(value).replace(/\s+/g, '').toLowerCase();
}

const HEADER_LABELS = Object.freeze({
  lokasibulky: 'LOKASI BULKY', sku: 'SKU', namabarang: 'NAMA BARANG', stokawal: 'STOK AWAL',
  internalstocktransfer: 'INTERNAL STOCK TRANSFER', replenishment: 'REPLENISHMENT',
  pengeluaran: 'PENGELUARAN', stokakhir: 'STOK AKHIR', iseller: 'Iseller', netsuite: 'Netsuite',
  selisih: 'Selisih', pendinganit: 'Pendingan IT',
});
export const REQUIRED_HEADERS = Object.freeze(Object.keys(HEADER_LABELS));

const NUMBER_FIELDS = Object.freeze([
  ['stokawal', 'stok_awal'],
  ['internalstocktransfer', 'internal_stock_transfer'],
  ['replenishment', 'replenishment'],
  ['pengeluaran', 'pengeluaran'],
  ['stokakhir', 'stok_akhir'],
  ['iseller', 'iseller'],
  ['netsuite', 'netsuite'],
  ['selisih', 'selisih'],
  ['pendinganit', 'pendingan_it'],
]);

function detectHeaderRow(values) {
  let best = null;
  for (let index = 0; index < values.length; index += 1) {
    if (!Array.isArray(values[index])) continue;
    const normalized = values[index].map(normalizeBulkyHeader);
    const keys = new Set(normalized);
    if (!keys.has('sku') || !keys.has('namabarang')) continue;
    const score = REQUIRED_HEADERS.filter(header => keys.has(header)).length;
    if (!best || score > best.score) best = { index, normalized, score };
  }
  return best || (Array.isArray(values[0]) ? { index: 0, normalized: values[0].map(normalizeBulkyHeader), score: 0 } : null);
}

function headerDebug(values, detected) {
  const rawHeaders = detected ? values[detected.index].map(value => String(value ?? '')) : [];
  const normalizedHeaders = detected?.normalized || [];
  return {
    sheetName: BULKY_SHEET_NAME,
    range: BULKY_SHEET_RANGE,
    headerRow: detected ? detected.index + 1 : null,
    rawHeaders,
    normalizedHeaders,
    headerIndexes: rawHeaders.map((raw, index) => ({
      index,
      raw,
      escaped: JSON.stringify(raw).slice(1, -1),
      characterCodes: [...raw].map(character => character.codePointAt(0)),
      normalized: normalizedHeaders[index],
    })),
    expectedBusinessHeaders: ['iseller', 'netsuite', 'selisih', 'pendinganit'],
  };
}

async function parseValues(values, helpers) {
  if (!Array.isArray(values)) throw new SyncError('INVALID_HEADER', 'Header BULKY tidak ditemukan');
  const detected = detectHeaderRow(values);
  const debug = headerDebug(values, detected);
  helpers.logger?.log?.(`[BulkyHeaderDebug] ${JSON.stringify(debug)}`);
  if (!detected) throw new SyncError('INVALID_HEADER', 'Header BULKY tidak ditemukan', {
    missingHeader: 'Iseller, Netsuite, Selisih, Pendingan IT', headerRowNumber: null, detectedHeaders: [], normalizedHeaders: [],
  });
  const indexes = new Map(detected.normalized.map((header, index) => [header, index]));
  const missing = REQUIRED_HEADERS.filter(header => !indexes.has(header));
  if (missing.length) throw new SyncError('INVALID_HEADER', `Header wajib tidak ditemukan: ${missing.map(header => HEADER_LABELS[header]).join(', ')}`, {
    missingHeader: missing.map(header => HEADER_LABELS[header]).join(', '),
    headerRowNumber: detected.index + 1,
    detectedHeaders: debug.rawHeaders,
    normalizedHeaders: debug.normalizedHeaders,
  });

  const rows = [], invalidRows = [], sourceKeys = new Set(); let sourceRowCount = 0;
  for (let index = detected.index + 1; index < values.length; index += 1) {
    const cells = Array.isArray(values[index]) ? values[index] : [], sourceRowNumber = index + 1, read = header => cells[indexes.get(header)];
    if (REQUIRED_HEADERS.every(header => normalizeText(read(header)) === '')) continue;
    sourceRowCount += 1;
    const source_row_key = helpers.buildSourceRowKey(sourceRowNumber); sourceKeys.add(source_row_key);
    const numbers = Object.fromEntries(NUMBER_FIELDS.map(([header, field]) => [field, normalizeNumber(read(header))]));
    const row = {
      lokasi_bulky: normalizeLocation(read('lokasibulky')),
      sku: normalizeSku(read('sku')),
      nama_barang: normalizeText(read('namabarang')),
      ...Object.fromEntries(NUMBER_FIELDS.map(([, field]) => [field, numbers[field].value])),
      source_row_key,
      source_row_number: sourceRowNumber,
    };
    const errors = [];
    if (!row.sku) errors.push('SKU_REQUIRED');
    for (const [header, field] of NUMBER_FIELDS) if (!numbers[field].valid) errors.push(`INVALID_NUMBER:${HEADER_LABELS[header].toUpperCase()}`);
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
    'pengeluaran', 'stok_akhir', 'iseller', 'netsuite', 'selisih', 'pendingan_it',
  ],
  metadataFields: ['iseller', 'netsuite', 'selisih', 'pendingan_it'],
  needsUpdate: (existing, row) => ['iseller', 'netsuite', 'selisih', 'pendingan_it']
    .some(field => existing[field] == null && row[field] != null),
  buildMetrics({ parsed, existing, diff }) {
    const existingByKey = new Map(existing.map(row => [row.source_row_key, row]));
    const backfilledFields = ['iseller', 'netsuite', 'selisih', 'pendingan_it'];
    const isBackfill = row => backfilledFields.some(field => existingByKey.get(row.source_row_key)?.[field] == null && row[field] != null);
    return {
      backfilledRows: diff.rowsToUpdate.filter(isBackfill).length,
      nullIsellerRows: parsed.rows.filter(row => row.iseller == null).length,
      nullNetsuiteRows: parsed.rows.filter(row => row.netsuite == null).length,
      nullSelisihRows: parsed.rows.filter(row => row.selisih == null).length,
      nullPendinganItRows: parsed.rows.filter(row => row.pendingan_it == null).length,
      invalidNumericValues: parsed.invalidRows.reduce((total, row) => total + row.errors.filter(error => error.startsWith('INVALID_NUMBER:')).length, 0),
    };
  },
  sheetRange: BULKY_SHEET_RANGE,
});

export const buildSourceRowKey = service.buildSourceRowKey;
export const buildSourceHash = service.buildSourceHash;
export const fetchBulkyValues = service.fetchValues;
export function syncBulky(env, dependencies = {}) {
  const logger = dependencies.logger || console;
  const range = BULKY_SHEET_RANGE;
  (logger?.log || console.log)(
    `[InventorySync:${SYNC_SOURCE}]\n` +
    `sheetName: ${BULKY_SHEET_NAME}\n` +
    `range: ${range}`,
  );
  return service.sync(env, dependencies);
}
export function parseBulkyValues(values) { return parseValues(values, service); }
