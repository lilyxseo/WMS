import { SHEET_BARANG_KELUAR } from '../../_barang-ops.js';
import { createInventorySyncService, normalizeDate, normalizeLocation, normalizeNumber, normalizeSku, normalizeText, normalizedHeader, SyncError } from './_sync-engine.js';

export const SYNC_SOURCE = 'barang_keluar';
export const BARANG_KELUAR_SHEET_NAME = SHEET_BARANG_KELUAR;
export const REQUIRED_HEADERS = Object.freeze(['TANGGAL', 'FROM', 'TO', 'SKU', 'NAMABARANG', 'QTY', 'STATUS', 'PIC', 'KETERANGAN', 'NO ISELLER', 'NETSUITE', 'KETERANGAN LAINNYA', 'LOKASI SURAT JALAN', 'NO ISELLER AWAL', 'DOKUMEN']);
export const BARANG_KELUAR_SHEET_RANGE = `'${BARANG_KELUAR_SHEET_NAME}'!A:P`;
export const BUSINESS_FIELDS = Object.freeze(['no_iseller', 'netsuite', 'keterangan_lainnya', 'status_lanjutan', 'lokasi_surat_jalan', 'no_iseller_awal', 'dokumen']);

async function parseValues(values, helpers) {
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw new SyncError('INVALID_HEADER', 'Header Barang Keluar tidak ditemukan');
  // STATUS occurs twice: the first is the transaction status and the second is
  // the later business status. Preserve both positions rather than collapsing them.
  const indexes = new Map(), occurrences = new Map();
  values[0].forEach((header, index) => {
    const normalized = normalizedHeader(header);
    if (!indexes.has(normalized)) indexes.set(normalized, index);
    occurrences.set(normalized, [...(occurrences.get(normalized) || []), index]);
  });
  const missing = REQUIRED_HEADERS.filter(header => !indexes.has(header));
  if ((occurrences.get('STATUS') || []).length < 2) missing.push('STATUS (kedua)');
  if (missing.length) throw new SyncError('INVALID_HEADER', `Header wajib tidak ditemukan: ${missing.join(', ')}`);
  const rows = [], invalidRows = [], sourceKeys = new Set(); let sourceRowCount = 0;
  for (let index = 1; index < values.length; index += 1) {
    const cells = Array.isArray(values[index]) ? values[index] : [], sourceRowNumber = index + 1, read = (header, occurrence = 0) => cells[(occurrences.get(header) || [])[occurrence]];
    if (REQUIRED_HEADERS.every(header => normalizeText(read(header)) === '')) continue;
    sourceRowCount += 1;
    const source_row_key = helpers.buildSourceRowKey(sourceRowNumber); sourceKeys.add(source_row_key);
    const qty = normalizeNumber(read('QTY')), tanggal = normalizeDate(read('TANGGAL'));
    const row = {
      tanggal: tanggal.value, from_location: normalizeLocation(read('FROM')), to_location: normalizeLocation(read('TO')),
      sku: normalizeSku(read('SKU')), nama_barang: normalizeText(read('NAMABARANG')), qty: qty.value,
      status: normalizeText(read('STATUS')), pic: normalizeText(read('PIC')), keterangan: normalizeText(read('KETERANGAN')),
      no_iseller: normalizeText(read('NO ISELLER')), netsuite: normalizeText(read('NETSUITE')),
      keterangan_lainnya: normalizeText(read('KETERANGAN LAINNYA')), status_lanjutan: normalizeText(read('STATUS', 1)),
      lokasi_surat_jalan: normalizeText(read('LOKASI SURAT JALAN')), no_iseller_awal: normalizeText(read('NO ISELLER AWAL')),
      dokumen: normalizeText(read('DOKUMEN')),
      source_row_key, source_row_number: sourceRowNumber,
    };
    const errors = []; if (!row.sku) errors.push('SKU_REQUIRED'); if (!qty.valid) errors.push('INVALID_NUMBER:QTY'); if (!tanggal.valid) errors.push('INVALID_DATE:TANGGAL');
    if (errors.length) { invalidRows.push({ sourceRowNumber, sourceRowKey: source_row_key, errors }); continue; }
    row.source_hash = await helpers.buildSourceHash(row); rows.push(row);
  }
  return { rows, invalidRows, sourceKeys, sourceRowCount };
}

const service = createInventorySyncService({
  source: SYNC_SOURCE, sheetName: BARANG_KELUAR_SHEET_NAME, sheetRange: BARANG_KELUAR_SHEET_RANGE, tableName: 'inventory_barang_keluar', parseValues,
  hashFields: ['tanggal', 'from_location', 'to_location', 'sku', 'nama_barang', 'qty', 'status', 'pic', 'keterangan', ...BUSINESS_FIELDS],
  metadataFields: BUSINESS_FIELDS,
  needsUpdate: (existing, row) => BUSINESS_FIELDS.some(field => existing[field] == null && row[field] !== ''),
});
export const buildSourceRowKey = service.buildSourceRowKey;
export const buildSourceHash = service.buildSourceHash;
export const fetchBarangKeluarValues = service.fetchValues;
export const syncBarangKeluar = service.sync;
export function parseBarangKeluarValues(values) { return parseValues(values, service); }
