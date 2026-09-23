import { businessDateKey, loadInventoryAnalyticsRows, normalizeTransactionDate } from './_inventory-analytics.js';

export const WARNING_CATEGORIES = Object.freeze({
  OUTBOUND_WITHOUT_INBOUND: 'SKU Keluar Tanpa Data Masuk', NAME_MISMATCH: 'Nama Barang Tidak Konsisten',
  EMPTY_SKU: 'SKU Kosong / Invalid', EMPTY_NAME: 'Nama Barang Kosong', EMPTY_LOCATION: 'Lokasi Kosong',
  NEGATIVE_STOCK: 'Stock Negatif', MISSING_NETSUITE: 'Referensi NETSUITE Kosong',
  ACCURACY_MISMATCH: 'Accuracy Mismatch', INVALID_DATE: 'Tanggal Invalid', INVALID_QTY: 'QTY Invalid',
});
const SOURCE_NAMES = { kartuStok: 'Kartu Stok', rpl: 'RPL', bulky: 'BULKY', barangMasuk: 'Barang Masuk', barangKeluar: 'Barang Keluar' };
const severityRank = { High: 1, Medium: 2, Low: 3 };
export const normalizeWarningSku = value => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim().toUpperCase();
export const normalizeWarningName = value => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
const text = value => String(value ?? '').trim();
const number = value => value === null || value === undefined || text(value) === '' ? null : Number(String(value).replace(/,/g, ''));
function warning(category, severity, source, row, issue, evidence, recommendation) {
  return { id: [category, source, row.source_row_number ?? '', normalizeWarningSku(row.sku), evidence].join(':'), category, categoryLabel: WARNING_CATEGORIES[category], severity, source, sku: text(row.sku) || '-', namaBarang: text(row.nama_barang) || '-', issue, evidence, recommendation, location: text(row.lokasi_bulky || row.from_location || row.to_location), eventDate: text(row.tanggal) };
}
function validCalendarDate(value) {
  const normalized = normalizeTransactionDate(value); if (!normalized) return false;
  const [year, month, day] = normalized.split('-').map(Number), date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export function buildInventoryWarnings(rows) {
  const result = [], entries = Object.entries(rows), inboundSkus = new Set(rows.barangMasuk.map(row => normalizeWarningSku(row.sku)).filter(Boolean)), outboundBySku = new Map();
  for (const row of rows.barangKeluar) { const sku = normalizeWarningSku(row.sku); if (sku && !outboundBySku.has(sku)) outboundBySku.set(sku, row); }
  for (const [sku, row] of outboundBySku) if (!inboundSkus.has(sku)) result.push(warning('OUTBOUND_WITHOUT_INBOUND', 'High', 'Barang Keluar', row, 'Barang keluar ada, tetapi SKU tidak pernah tercatat di Barang Masuk.', `SKU ${text(row.sku)} ditemukan di Barang Keluar dan tidak ditemukan di seluruh Barang Masuk.`, 'Periksa dan lengkapi data Barang Masuk.'));
  const names = new Map();
  for (const [sourceKey, sourceRows] of entries) for (const row of sourceRows) {
    const source = SOURCE_NAMES[sourceKey], sku = normalizeWarningSku(row.sku), name = normalizeWarningName(row.nama_barang);
    if (!sku) result.push(warning('EMPTY_SKU', 'High', source, row, 'SKU kosong atau hanya berisi spasi.', `${source} baris ${row.source_row_number ?? '-'}: SKU = NULL/kosong.`, 'Lengkapi SKU dari dokumen sumber.'));
    else if (!name) result.push(warning('EMPTY_NAME', 'Low', source, row, 'Nama barang kosong.', `${source} SKU ${text(row.sku)}${row.tanggal ? `, tanggal ${row.tanggal}` : row.lokasi_bulky ? `, lokasi ${row.lokasi_bulky}` : ''}: nama barang = NULL/kosong.`, 'Lengkapi nama barang sesuai master yang telah dikonfirmasi.'));
    if (sku && name) { const item = names.get(sku) || new Map(), values = item.get(source) || new Map(); if (!values.has(name)) values.set(name, text(row.nama_barang)); item.set(source, values); names.set(sku, item); }
  }
  for (const [sku, sources] of names) { const distinct = new Set([...sources.values()].flatMap(values => [...values.keys()])); if (distinct.size > 1) { const evidence = [...sources].flatMap(([source, values]) => [...values.values()].map(value => `${source}: "${value}"`)).join('; '), sample = entries.flatMap(([, rs]) => rs).find(row => normalizeWarningSku(row.sku) === sku) || { sku }; result.push(warning('NAME_MISMATCH', 'Medium', [...sources.keys()].join(' / '), sample, 'SKU yang sama memiliki nama barang berbeda secara material.', evidence, 'Konfirmasi nama kanonis lalu standarkan semua sumber.')); } }
  for (const sourceKey of ['kartuStok', 'rpl', 'bulky']) for (const row of rows[sourceKey]) { const source = SOURCE_NAMES[sourceKey], stock = number(row.stok_akhir); if (stock !== null && Number.isFinite(stock) && stock > 0 && !text(row.lokasi_bulky)) result.push(warning('EMPTY_LOCATION', 'Medium', source, row, 'Stok positif tidak memiliki lokasi.', `${source} SKU ${text(row.sku) || '-'}: stok akhir = ${stock}, lokasi = NULL/kosong.`, 'Tetapkan lokasi operasional yang sah.')); }
  for (const row of rows.kartuStok) { const stock = number(row.stok_akhir); if (stock !== null && stock < 0) result.push(warning('NEGATIVE_STOCK', 'High', 'Kartu Stok', row, 'Stok akhir berada di bawah nol.', `Kartu Stok SKU ${text(row.sku) || '-'}${row.lokasi_bulky ? ` di ${row.lokasi_bulky}` : ''}: stok akhir = ${stock}.`, 'Telusuri mutasi dan koreksi saldo pada sumber.')); }
  for (const row of rows.bulky) if (row.netsuite === null || !text(row.netsuite)) result.push(warning('MISSING_NETSUITE', 'Medium', 'BULKY', row, 'Referensi NETSUITE kosong.', `BULKY SKU ${text(row.sku) || '-'}${row.lokasi_bulky ? ` di ${row.lokasi_bulky}` : ''}: NETSUITE = NULL.`, 'Lengkapi referensi NETSUITE untuk rekonsiliasi akurasi.'));
  // Keep the exact Stock Accuracy invariant from computeInventorySummary:
  // aggregate RPL + BULKY `selisih` by normalized SKU, then compare with zero.
  const accuracy = new Map();
  for (const sourceKey of ['rpl', 'bulky']) for (const row of rows[sourceKey]) { const sku = normalizeWarningSku(row.sku); if (!sku) continue; const item = accuracy.get(sku) || { difference: 0, row, sources: new Set() }; item.difference += number(row.selisih) || 0; item.sources.add(SOURCE_NAMES[sourceKey]); accuracy.set(sku, item); }
  for (const item of accuracy.values()) if (item.difference !== 0) result.push(warning('ACCURACY_MISMATCH', 'High', [...item.sources].join(' / '), item.row, 'Saldo tidak cocok dengan referensi Stock Accuracy.', `Total selisih RPL/BULKY untuk SKU ${text(item.row.sku) || '-'} = ${item.difference}.`, 'Tindak lanjuti selisih melalui proses Stock Accuracy.'));
  for (const sourceKey of ['barangMasuk', 'barangKeluar']) for (const row of rows[sourceKey]) { const source = SOURCE_NAMES[sourceKey]; if (!validCalendarDate(row.tanggal)) result.push(warning('INVALID_DATE', 'Medium', source, row, 'Tanggal transaksi kosong atau tidak valid.', `${source} SKU ${text(row.sku) || '-'}: raw TANGGAL = "${text(row.tanggal)}".`, 'Isi tanggal kalender valid (YYYY-MM-DD atau M/D/YYYY).')); const quantity = number(row.qty); if (quantity === null || !Number.isFinite(quantity)) result.push(warning('INVALID_QTY', 'High', source, row, 'QTY wajib berupa angka.', `${source} SKU ${text(row.sku) || '-'}: raw QTY = "${text(row.qty)}".`, 'Isi QTY numerik; nilai 0 tetap diperbolehkan.')); }
  return result;
}
export function queryInventoryWarnings(allRows, options = {}) {
  const severity = text(options.severity), category = text(options.category), source = text(options.source), terms = text(options.search).toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean);
  let rows = allRows.filter(row => (!severity || severity === 'all' || row.severity === severity) && (!category || category === 'all' || row.category === category) && (!source || source === 'all' || row.source.split(' / ').includes(source)) && terms.every(term => `${row.sku} ${row.namaBarang} ${row.issue} ${row.location} ${row.evidence}`.toLocaleLowerCase('id-ID').includes(term)));
  const collator = new Intl.Collator('id-ID', { sensitivity: 'base', numeric: true }), comparators = { sku: (a,b) => collator.compare(a.sku,b.sku), name: (a,b) => collator.compare(a.namaBarang,b.namaBarang), category: (a,b) => collator.compare(a.categoryLabel,b.categoryLabel), newest: (a,b) => String(b.eventDate).localeCompare(String(a.eventDate)), severity: (a,b) => severityRank[a.severity]-severityRank[b.severity] }, compare = comparators[options.sort] || comparators.severity;
  rows = rows.sort((a,b) => compare(a,b) || collator.compare(a.sku,b.sku) || collator.compare(a.id,b.id)); const total = rows.length, limit = Math.min(100, Math.max(1, Number(options.limit) || 25)), page = Math.max(1, Number(options.page) || 1);
  return { rows: rows.slice((page-1)*limit, page*limit), total, page, limit };
}
export async function loadInventoryWarnings(env, options) {
  const { rows, failures } = await loadInventoryAnalyticsRows(env);
  // Absence of a source is not evidence of absence. Never emit cross-source
  // warnings from a partial snapshot because that would create false positives.
  if (failures.length) throw new Error(`Warning sources unavailable: ${failures.map(item => item.source).join(', ')}`);
  const warnings = buildInventoryWarnings(rows), result = queryInventoryWarnings(warnings, options), byCategory = Object.fromEntries(Object.keys(WARNING_CATEGORIES).map(key => [key, warnings.filter(row => row.category === key).length]));
  return { ...result, summary: { total: warnings.length, high: warnings.filter(row => row.severity === 'High').length, medium: warnings.filter(row => row.severity === 'Medium').length, low: warnings.filter(row => row.severity === 'Low').length, byCategory }, categories: WARNING_CATEGORIES, partial: false, unavailableSources: [], businessDate: businessDateKey() };
}
