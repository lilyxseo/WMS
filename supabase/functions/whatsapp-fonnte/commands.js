import { normalizeSearchQuery, buildInventorySearchFilters } from './inventory-search.js';
import { renderMenu, displayText } from './menu.js';
import { searchTransactions } from './transactions.js';

export const BOT_HELP = renderMenu();

export class CommandError extends Error {}

export function parseAdvancedCommand(message) {
  const input = String(message ?? '').trim();
  const advanced = /^(detail\s|(?:barang\s+)?(?:masuk|keluar)(?:\s|;|$))/i.test(input) || /[;=]/.test(input);
  if (!advanced) return undefined;
  if (input.length > 400) throw new CommandError('Perintah maksimal 400 karakter.');
  const parts = input.split(';').map(part => part.trim());
  let first = parts.shift();
  const filters = [];
  let detail = false;
  const options = { page: 1, source: '', stock: 'semua', filters };
  const transaction = /^(?:barang\s+)?(masuk|keluar)(?:\s+(.*))?$/i.exec(first);
  if (transaction) {
    options.source = transaction[1].toLowerCase() === 'masuk' ? 'Barang Masuk' : 'Barang Keluar';
    first = transaction[2] || '';
  }
  const names = { sku: 'sku', nama: 'nama_barang', barang: 'nama_barang', lokasi: 'lokasi_bulky', tanggal: 'tanggal', status: 'status', pic: 'pic', dokumen: 'dokumen', jumlah: 'qty' };
  const seen = new Set();
  const add = part => {
    const match = /^([a-z]+)\s*=\s*(.+)$/i.exec(part);
    if (!match) throw new CommandError('Gunakan filter nama=nilai, dipisahkan titik koma. Ketik bantuan untuk contoh.');
    const name = match[1].toLowerCase(), value = normalizeSearchQuery(match[2]);
    if (seen.has(name)) throw new CommandError(`Filter ${name} hanya boleh diisi sekali.`);
    seen.add(name);
    if (names[name]) {
      if (value.length < 2 && name !== 'jumlah') throw new CommandError('Pencarian minimal 2 karakter.');
      filters.push({ query: value, fields: [names[name]] });
    } else if (name === 'halaman') {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value) * 10)) throw new CommandError('Halaman harus berupa angka bulat positif yang valid.');
      options.page = Number(value);
    } else if (name === 'sumber') {
      const source = { 'kartu stock': 'Kartu Stock', 'kartu stok': 'Kartu Stock', rpl: 'RPL', bulky: 'BULKY', 'barang masuk': 'Barang Masuk', masuk: 'Barang Masuk', 'barang keluar': 'Barang Keluar', keluar: 'Barang Keluar' }[value];
      if (!source) throw new CommandError('Sumber harus Kartu Stock, RPL, BULKY, Barang Masuk, atau Barang Keluar.');
      if (transaction && source !== options.source) throw new CommandError('Filter sumber tidak sesuai perintah masuk/keluar.');
      options.source = source;
    } else if (name === 'stok') {
      if (!['ada', 'kosong', 'semua'].includes(value)) throw new CommandError('Stok harus ada, kosong, atau semua.');
      options.stock = value;
    } else throw new CommandError(`Filter ${name} tidak dikenal. Ketik bantuan.`);
  };
  const opening = first.replace(/^cari\s+/i, '');
  if (opening.includes('=')) add(opening);
  else if (first) {
    const match = /^(detail|sku|barang|nama(?:\s+barang)?|lokasi|cari)\s+(.+)$/i.exec(first);
    const mode = match?.[1].toLowerCase() || 'cari';
    const query = normalizeSearchQuery(match ? match[2] : first);
    if (query.length < 2) throw new CommandError('Pencarian minimal 2 karakter.');
    detail = mode === 'detail';
    filters.push({ query, fields: mode === 'sku' || detail ? ['sku'] : mode === 'lokasi' ? ['lokasi_bulky']
      : mode === 'barang' || mode.startsWith('nama') ? ['nama_barang'] : ['sku', 'nama_barang', 'lokasi_bulky'], exact: detail });
  }
  parts.forEach(add);
  if (!filters.length && !transaction) throw new CommandError('Isi kata pencarian untuk mencari.');
  if (/^Barang (Masuk|Keluar)$/.test(options.source) && options.stock !== 'semua') throw new CommandError('Filter stok hanya untuk sumber stok, bukan jumlah transaksi.');
  return { ...options, detail, hideZero: !transaction && !seen.has('stok'), command: input.replace(/;\s*halaman\s*=\s*\d+\s*/ig, '').trim() };
}

export async function searchAdvancedInventory(env, search, fetchFn, sources, config) {
  // One independent sorted query per source; page each source so no source is starved.
  const exact = search.filters.filter(item => item.exact).map(item =>
    `&sku=ilike.${encodeURIComponent(item.query.replace(/[\\%_*]/g, char => `\\${char}`))}`
  ).join('');
  const clauses = search.filters.filter(item => !item.exact).flatMap(item => buildInventorySearchFilters(item.query, item.fields));
  const filter = exact + (clauses.length > 1 ? `&and=(${clauses.map(clause => clause.replace(/^or=/, 'or')).join(',')})` : clauses.length ? `&${clauses[0]}` : '');
  const stock = search.stock === 'ada' ? '&stok_akhir=gt.0' : search.stock === 'kosong' ? '&stok_akhir=eq.0' : search.hideZero ? '&stok_akhir=neq.0' : '';
  const selectedSource = search.source || 'Kartu Stock';
  const batches = await Promise.all(sources.filter(([name]) => name === selectedSource).map(async ([source, table]) => {
    if (/^Barang (Masuk|Keluar)$/.test(source)) {
      if (search.stock !== 'semua') return { source, rows: [], hasMore: false };
      return searchTransactions(config, table, source, search, fetchFn);
    }
    if (search.filters.some(item => item.fields.some(field => !['sku', 'nama_barang', 'lokasi_bulky'].includes(field)))) return { source, rows: [], hasMore: false };
    const response = await fetchFn(`${config.url}/rest/v1/${table}?select=sku,nama_barang,lokasi_bulky,stok_akhir,synced_at${filter}${stock}&order=sku.asc,lokasi_bulky.asc,source_row_number.asc&offset=${(search.page - 1) * 10}&limit=11`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Inventory lookup failed');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid inventory response');
    return { source, rows: rows.slice(0, 10), hasMore: rows.length > 10 };
  }));
  return { rows: batches.flatMap(batch => batch.rows.map(row => ({ ...row, source: batch.source }))), hasMore: batches.some(batch => batch.hasMore), incomplete: batches.some(batch => batch.incomplete) };
}

export function formatAdvancedReply(result, search, formatRows) {
  const previous = search.page > 1 ? '\nHalaman sebelumnya: balas sebelumnya.' : '';
  if (!result.rows.length) return (search.page > 1 ? `🔎 *Hasil Pencarian*\nTidak ada hasil pada halaman ${search.page}.` : formatRows([]))
    + previous + '\n\n💡 Coba kata lebih singkat atau hapus filter sumber/stok.\nKetik menu untuk panduan pencarian.';
  const body = formatRows(result.rows, 15);
  const dates = result.rows.map(row => Date.parse(row.synced_at)).filter(Number.isFinite);
  const freshness = dates.length ? `\nSinkronisasi tertua pada hasil: ${new Date(Math.min(...dates)).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.` : '\nWaktu sinkronisasi tidak tersedia.';
  const scope = `Sumber: ${search.source || 'Kartu Stock'} • ${search.hideZero ? 'Stok 0 disembunyikan' : `Filter stok: ${search.stock || 'semua'}`}`;
  return `🔎 *Hasil Pencarian WMS*\nPencarian: ${displayText(search.command, 400)}\n${scope}\nHalaman ${search.page} • ${result.rows.length} baris ditampilkan\n\n${body}\n\n🕒 ${freshness.trim()}`
    + previous + (result.hasMore ? '\n\nHalaman berikutnya: balas lanjut.' : '\n\n✅ Akhir hasil pencarian.')
    + '\n\nKetik menu untuk pencarian lainnya.';
}
