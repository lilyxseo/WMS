import { normalizeSearchQuery, buildInventorySearchQuery } from './inventory-search.js';

export const BOT_HELP = `Bot stok WMS
sku ABC123 — cari SKU
barang kabel — cari nama
lokasi A-01 — cari lokasi
detail ABC123 — SKU persis
cari kabel A-01 — cari gabungan
cari nama=kabel; lokasi=A-01; sumber=RPL; stok=ada
Tambahkan ; halaman=2 untuk hasil berikutnya.
Sumber: Kartu Stock, RPL, BULKY. Stok: ada, kosong, semua.
Data mengikuti sinkronisasi terakhir WMS.`;

export class CommandError extends Error {}

export function parseAdvancedCommand(message) {
  const input = String(message ?? '').trim();
  const advanced = /^detail\s/i.test(input) || /[;=]/.test(input);
  if (!advanced) return undefined;
  if (input.length > 400) throw new CommandError('Perintah maksimal 400 karakter.');
  const parts = input.split(';').map(part => part.trim());
  const first = parts.shift();
  const filters = [];
  let detail = false;
  const options = { page: 1, source: '', stock: 'semua', filters };
  const names = { sku: 'sku', nama: 'nama_barang', barang: 'nama_barang', lokasi: 'lokasi_bulky' };
  const seen = new Set();
  const add = part => {
    const match = /^([a-z]+)\s*=\s*(.+)$/i.exec(part);
    if (!match) throw new CommandError('Gunakan filter nama=nilai, dipisahkan titik koma. Ketik bantuan untuk contoh.');
    const name = match[1].toLowerCase(), value = normalizeSearchQuery(match[2]);
    if (seen.has(name)) throw new CommandError(`Filter ${name} hanya boleh diisi sekali.`);
    seen.add(name);
    if (names[name]) {
      if (value.length < 2) throw new CommandError('Pencarian minimal 2 karakter.');
      filters.push({ query: value, fields: [names[name]] });
    } else if (name === 'halaman') {
      if (!/^[1-9]\d*$/.test(value) || Number(value) > 100) throw new CommandError('Halaman harus berupa angka 1–100.');
      options.page = Number(value);
    } else if (name === 'sumber') {
      const source = { 'kartu stock': 'Kartu Stock', 'kartu stok': 'Kartu Stock', rpl: 'RPL', bulky: 'BULKY' }[value];
      if (!source) throw new CommandError('Sumber harus Kartu Stock, RPL, atau BULKY.');
      options.source = source;
    } else if (name === 'stok') {
      if (!['ada', 'kosong', 'semua'].includes(value)) throw new CommandError('Stok harus ada, kosong, atau semua.');
      options.stock = value;
    } else throw new CommandError(`Filter ${name} tidak dikenal. Ketik bantuan.`);
  };
  const opening = first.replace(/^cari\s+/i, '');
  if (opening.includes('=')) add(opening);
  else {
    const match = /^(detail|sku|barang|nama(?:\s+barang)?|lokasi|cari)\s+(.+)$/i.exec(first);
    const mode = match?.[1].toLowerCase() || 'cari';
    const query = normalizeSearchQuery(match ? match[2] : first);
    if (query.length < 2) throw new CommandError('Pencarian minimal 2 karakter.');
    detail = mode === 'detail';
    filters.push({ query, fields: mode === 'sku' || detail ? ['sku'] : mode === 'lokasi' ? ['lokasi_bulky']
      : mode === 'barang' || mode.startsWith('nama') ? ['nama_barang'] : ['sku', 'nama_barang', 'lokasi_bulky'], exact: detail });
  }
  parts.forEach(add);
  if (!filters.length) throw new CommandError('Isi SKU, nama barang, atau lokasi untuk mencari.');
  return { ...options, detail, command: input.replace(/;\s*halaman\s*=\s*\d+\s*/ig, '').trim() };
}

export async function searchAdvancedInventory(env, search, fetchFn, sources, config) {
  // One independent sorted query per source; page each source so no source is starved.
  const filter = search.filters.map(item => item.exact
    ? `&sku=ilike.${encodeURIComponent(item.query.replace(/[\\%_*]/g, char => `\\${char}`))}`
    : buildInventorySearchQuery(item.query, item.fields)).join('');
  const stock = search.stock === 'ada' ? '&stok_akhir=gt.0' : search.stock === 'kosong' ? '&stok_akhir=eq.0' : '';
  const batches = await Promise.all(sources.filter(([name]) => !search.source || name === search.source).map(async ([source, table]) => {
    const response = await fetchFn(`${config.url}/rest/v1/${table}?select=sku,nama_barang,lokasi_bulky,stok_akhir,synced_at${filter}${stock}&order=sku.asc,lokasi_bulky.asc,source_row_number.asc&offset=${(search.page - 1) * 3}&limit=4`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Inventory lookup failed');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid inventory response');
    return { source, rows: rows.slice(0, 3), hasMore: rows.length > 3 };
  }));
  return { rows: batches.flatMap(batch => batch.rows.map(row => ({ ...row, source: batch.source }))), hasMore: batches.some(batch => batch.hasMore) };
}

export function formatAdvancedReply(result, search, formatRows) {
  if (!result.rows.length) return search.page > 1 ? `Tidak ada hasil pada halaman ${search.page}. Coba halaman sebelumnya.` : formatRows([]);
  const body = formatRows(result.rows);
  const dates = result.rows.map(row => Date.parse(row.synced_at)).filter(Number.isFinite);
  const freshness = dates.length ? `\nSinkronisasi tertua pada hasil: ${new Date(Math.min(...dates)).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.` : '\nWaktu sinkronisasi tidak tersedia.';
  return `Halaman ${search.page} (maksimal 3 baris per sumber)\n${body}${freshness}`
    + (result.hasMore && search.page < 100 ? `\n\nBerikutnya, kirim:\n${search.command}; halaman=${search.page + 1}` : result.hasMore ? '\nPerjelas pencarian untuk hasil tambahan.' : '\nAkhir hasil pencarian.');
}
