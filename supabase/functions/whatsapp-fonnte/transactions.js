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
  let incomplete = false;
  // Bounded reads match numeric qty and other business values without casting database fields.
  const maxRows = 5000, batchSize = 1000;
  const needed = search.page * 3 + 1;
  for (let offset = 0; offset <= maxRows; offset += batchSize) {
    const limit = offset === maxRows ? 1 : batchSize;
    const response = await fetchFn(`${config.url}/rest/v1/${table}?select=${fields.join(',')}&order=source_row_number.desc&offset=${offset}&limit=${limit}`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Transaction lookup failed');
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Invalid transaction response');
    if (offset === maxRows) { incomplete = batch.length > 0; break; }
    rows.push(...batch.filter(row => transactionMatches(row, search.filters)));
    if (rows.length >= needed || batch.length < batchSize) break;
  }
  const offset = (search.page - 1) * 3;
  return { source, rows: rows.slice(offset, offset + 3), hasMore: rows.length > offset + 3, incomplete };
}

export function formatTransactionRow(row, index) {
  const clean = displayText;
  return `*${index + 1}. ${clean(row.nama_barang)}*\nSKU: ${clean(row.sku)}\nTanggal: ${clean(row.tanggal)}\nAsal: ${clean(row.from_location)}\nTujuan: ${clean(row.to_location)}\nJumlah transaksi: ${clean(row.qty)}\nStatus: ${clean(row.status)}\nPIC: ${clean(row.pic)}\nKeterangan: ${clean(row.keterangan)}\nDokumen: ${clean(row.dokumen)}\nSumber: ${clean(row.source)}`;
}
