import { inventorySearchGroups } from './inventory-search.js';
import { displayText } from './menu.js';

const COMMON = ['tanggal', 'from_location', 'to_location', 'sku', 'nama_barang', 'qty', 'status', 'pic', 'keterangan', 'no_iseller', 'netsuite', 'keterangan_lainnya', 'lokasi_surat_jalan', 'dokumen'];
const SEARCHABLE = [...COMMON, 'stockout', 'status_lanjutan', 'no_iseller_awal', 'lokasi_bulky'];
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('id').replace(/\s+/g, ' ').trim();

export function transactionMatches(row, filters) {
  return filters.every(filter => {
    const fields = filter.fields.length > 1 ? SEARCHABLE
      : filter.fields[0] === 'lokasi_bulky' ? ['from_location', 'to_location', 'lokasi_surat_jalan'] : filter.fields;
    if (filter.exact) return normalize(row.sku) === normalize(filter.query);
    const text = normalize(fields.map(key => row[key]).join(' '));
    return inventorySearchGroups(filter.query).some(query => normalize(query).split(' ').every(token => text.includes(token)));
  });
}

export function searchPageSize(source) {
  return source === 'Barang Keluar' ? 3 : 10;
}

export async function searchTransactions(config, table, source, search, fetchFn) {
  const fields = [...COMMON, ...(source === 'Barang Masuk' ? ['stockout'] : ['status_lanjutan', 'no_iseller_awal']), 'source_row_number'];
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
  const rows = [];
  const pageSize = searchPageSize(source);
  const batchSize = 1000, skip = (search.page - 1) * pageSize;
  let matched = 0;
  // Count every matching row while retaining only the requested page.
  for (let offset = 0; ; offset += batchSize) {
    const limit = batchSize;
    const response = await fetchFn(`${config.url}/rest/v1/${table}?select=${fields.join(',')}&order=source_row_number.desc&offset=${offset}&limit=${limit}`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Transaction lookup failed');
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Invalid transaction response');
    for (const row of batch) {
      if ((!search.hideZero || Number(row.qty) !== 0) && transactionMatches(row, search.filters)) {
        if (matched >= skip && rows.length < pageSize) rows.push(row);
        matched++;
      }
    }
    if (batch.length < batchSize) break;
  }
  return { source, rows, total: matched, hasMore: matched > skip + pageSize };
}

export function formatTransactionRow(row, index) {
  const clean = displayText;
  return `*${index + 1}. ${clean(row.nama_barang)}*\nSKU: ${clean(row.sku)}\nTanggal: ${clean(row.tanggal)}\nFrom: ${clean(row.from_location)}\nTo: ${clean(row.to_location)}\nQty: ${clean(row.qty)}\nStatus: ${clean(row.status)}\nPIC: ${clean(row.pic)}`;
}
