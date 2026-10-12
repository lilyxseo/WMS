// Match explicit WMS column aliases; never treat opening stock as closing stock.
const columns = {
  location: ['lokasi bulky', 'lokasi', 'location', 'rak', 'bin', 'area'],
  sku: ['sku', 'kode sku', 'kode barang', 'item code'],
  name: ['nama barang', 'nama produk', 'nama', 'item', 'description', 'product name'],
  qty: ['stok akhir', 'stock akhir', 'closing stock', 'ending stock', 'saldo akhir', 'stok', 'stock', 'qty', 'quantity', 'jumlah'],
};
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseKartuStockHeader(values) {
  let best = { headerIndex: -1, indices: [-1, -1, -1, -1], missing: Object.keys(columns) };
  for (let row = 0; row < Math.min(values.length, 50); row++) {
    if (!Array.isArray(values[row])) continue;
    const headers = values[row].map(normalize);
    const indices = Object.values(columns).map(aliases => {
      for (const alias of aliases) {
        const matches = headers.flatMap((header, index) => header === normalize(alias) ? [index] : []);
        if (matches.length) return matches.length === 1 ? matches[0] : -1;
      }
      return -1;
    });
    const missing = Object.keys(columns).filter((_, index) => indices[index] < 0);
    if (missing.length < best.missing.length) best = { headerIndex: row, indices, missing };
    if (!missing.length) return best;
  }
  return best;
}

export function stockHeaderFailure(parsed) {
  const labels = { location: 'Lokasi', sku: 'SKU', name: 'Nama Barang', qty: 'Stok Akhir' };
  return `Kolom Kartu Stock belum dikenali atau ganda: ${parsed.missing.map(key => labels[key]).join(', ')}. Ketik cek google untuk memeriksa header.`;
}
