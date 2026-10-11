import { displayText } from './menu.js';

const COMMON = ['tanggal', 'from_location', 'to_location', 'sku', 'nama_barang', 'qty', 'status', 'pic', 'keterangan', 'no_iseller', 'netsuite', 'keterangan_lainnya', 'lokasi_surat_jalan', 'dokumen'];
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('id').replace(/\s+/g, ' ').trim();

export function transactionMatches(row, filters) {
  return filters.every(filter => {
    const fields = filter.fields.length > 1 ? Object.keys(row).filter(key => key !== 'source_row_number')
      : filter.fields[0] === 'lokasi_bulky' ? ['from_location', 'to_location', 'lokasi_surat_jalan'] : filter.fields;
    if (filter.exact) return normalize(row.sku) === normalize(filter.query);
    const text = normalize(fields.map(key => row[key]).join(' '));
    return normalize(filter.query).split(' ').every(token => text.includes(token));
  });
}

export async function searchTransactions(config, table, source, search, fetchFn) {
  const fields = [...COMMON, ...(source === 'Barang Masuk' ? ['stockout'] : ['status_lanjutan', 'no_iseller_awal']), 'source_row_number'];
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
  const rows = [];
  const batchSize = 1000, skip = (search.page - 1) * 3;
  let matched = 0;
  const direct = !search.filters.length && !search.hideZero;
  // Read until the requested page and one lookahead match are found, or history ends.
  // Keep only four matches in memory, regardless of how much history is scanned.
  for (let offset = direct ? skip : 0; ; offset += batchSize) {
    const limit = direct ? 4 : batchSize;
    const response = await fetchFn(`${config.url}/rest/v1/${table}?select=${fields.join(',')}&order=source_row_number.desc&offset=${offset}&limit=${limit}`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Transaction lookup failed');
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Invalid transaction response');
    for (const row of batch) {
      if ((!search.hideZero || Number(row.qty) !== 0) && transactionMatches(row, search.filters)) {
        if (direct || matched >= skip) rows.push(row);
        matched++;
        if (rows.length === 4) break;
      }
    }
    if (direct || rows.length === 4 || batch.length < batchSize) break;
  }
  return { source, rows: rows.slice(0, 3), hasMore: rows.length > 3 };
}

export function formatTransactionRow(row, index) {
  const clean = displayText;
  return `*${index + 1}. ${clean(row.nama_barang)}*\nSKU: ${clean(row.sku)}\nTanggal: ${clean(row.tanggal)}\nFrom: ${clean(row.from_location)}\nTo: ${clean(row.to_location)}\nQty: ${clean(row.qty)}\nStatus: ${clean(row.status)}\nPIC: ${clean(row.pic)}`;
}
