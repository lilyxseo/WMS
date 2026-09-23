import { businessDateKey, loadInventoryAnalyticsRows } from './_inventory-analytics.js';
import { loadOutboundWithoutInbound } from './_outbound-without-inbound.js';

export const WARNING_CATEGORIES = Object.freeze({
  OUTBOUND_WITHOUT_INBOUND: 'SKU Keluar Tanpa Data Masuk', NAME_MISMATCH: 'Nama Barang Tidak Konsisten',
  EMPTY_SKU: 'SKU Kosong / Invalid', EMPTY_NAME: 'Nama Barang Kosong', EMPTY_LOCATION: 'Lokasi Kosong',
  NEGATIVE_STOCK: 'Stock Negatif',
  ACCURACY_MISMATCH: 'Accuracy Mismatch',
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
  // Keep the exact Stock Accuracy invariant from computeInventorySummary:
  // aggregate RPL + BULKY `selisih` by normalized SKU, then compare with zero.
  const accuracy = new Map();
  for (const sourceKey of ['rpl', 'bulky']) for (const row of rows[sourceKey]) { const sku = normalizeWarningSku(row.sku); if (!sku) continue; const item = accuracy.get(sku) || { difference: 0, row, sources: new Set() }; item.difference += number(row.selisih) || 0; item.sources.add(SOURCE_NAMES[sourceKey]); accuracy.set(sku, item); }
  for (const item of accuracy.values()) if (item.difference !== 0) result.push(warning('ACCURACY_MISMATCH', 'High', [...item.sources].join(' / '), item.row, 'Saldo tidak cocok dengan referensi Stock Accuracy.', `Total selisih RPL/BULKY untuk SKU ${text(item.row.sku) || '-'} = ${item.difference}.`, 'Tindak lanjuti selisih melalui proses Stock Accuracy.'));
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
  // Transaction ledgers are too large to download into a Worker reliably. The
  // proven cross-ledger rule uses its database RPC; snapshot rules read their
  // complete tables in bounded batches. Transaction date/QTY rules remain
  // disabled until equivalent database RPCs exist.
  const [snapshotResult, outboundResult] = await Promise.allSettled([
    loadInventoryAnalyticsRows(env, { sourceNames: ['kartuStok', 'rpl', 'bulky'] }),
    loadOutboundWithoutInbound(env),
  ]);
  if (snapshotResult.status === 'rejected') throw snapshotResult.reason;
  const { rows, failures } = snapshotResult.value;
  let warnings = buildInventoryWarnings(rows).filter(row => row.category !== 'OUTBOUND_WITHOUT_INBOUND');
  if (outboundResult.status === 'fulfilled') warnings.push(...outboundResult.value.map(row => ({ id: `OUTBOUND_WITHOUT_INBOUND:${normalizeWarningSku(row.sku)}`, category: 'OUTBOUND_WITHOUT_INBOUND', categoryLabel: WARNING_CATEGORIES.OUTBOUND_WITHOUT_INBOUND, severity: 'High', source: 'Barang Keluar', sku: row.sku, namaBarang: row.nama, issue: row.issue, evidence: `SKU ${row.sku} ditemukan di seluruh Barang Keluar dan tidak ditemukan di seluruh Barang Masuk.`, recommendation: row.recommendation, location: '', eventDate: '' })));
  const unavailableSources = failures.map(item => item.source);
  if (outboundResult.status === 'rejected') unavailableSources.push('inventory_outbound_without_inbound RPC');
  const result = queryInventoryWarnings(warnings, options), byCategory = Object.fromEntries(Object.keys(WARNING_CATEGORIES).map(key => [key, warnings.filter(row => row.category === key).length]));
  return { ...result, summary: { total: warnings.length, high: warnings.filter(row => row.severity === 'High').length, medium: warnings.filter(row => row.severity === 'Medium').length, low: warnings.filter(row => row.severity === 'Low').length, byCategory }, categories: WARNING_CATEGORIES, partial: unavailableSources.length > 0, unavailableSources, businessDate: businessDateKey() };
}
