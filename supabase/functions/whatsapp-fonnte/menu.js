// Register every new search command here: menus and command guidance use this list.
export const SEARCH_MENU = Object.freeze([
  { id: '1', command: 'cari', title: 'Pencarian global', description: 'Cari SKU, nama, dan lokasi hanya di Kartu Stok. Contoh gabungan: merlyn a20-1.', example: 'cari merlyn a20-1', extra: 'merlyn 6840' },
  { id: '2', command: 'masuk', title: 'Barang masuk', description: 'Cari data penerimaan berdasarkan barang, lokasi, tanggal, PIC, dokumen, atau jumlah.', example: 'masuk kabel', extra: 'masuk' },
  { id: '3', command: 'keluar', title: 'Barang keluar', description: 'Cari data pengeluaran berdasarkan barang, lokasi, tanggal, PIC, dokumen, atau jumlah.', example: 'keluar ABC123', extra: 'keluar' },
  { id: '4', command: 'edit', title: 'Edit transaksi', description: 'Cari barang masuk/keluar, pilih edit 1, lalu ikuti panduan kolom dan konfirmasi simpan. Khusus nomor editor.', example: 'edit 1', extra: 'masuk merlyn' },
]);

export function renderMenu(entries = SEARCH_MENU) {
  return [
    '📦 *Menu WMS*', '',
    ...entries.flatMap(item => [`*${item.id}. ${item.title}*`, `Contoh: ${item.example}`, '']),
    'Kirim pencarian langsung atau nomor menu untuk panduan.',
    'Navigasi: lanjut • sebelumnya • menu',
  ].join('\n');
}

export function resolveMenu(message) {
  const text = String(message ?? '').trim().toLowerCase();
  if (!text || /^(menu|help|bantuan|mulai|start|halo|hai)$/i.test(text)) return renderMenu();
  const topic = text.replace(/^(menu|help|bantuan)\s+/, '');
  const alias = { sku: 'cari', barang: 'cari', lokasi: 'cari', detail: 'cari' };
  const entry = SEARCH_MENU.find(item => item.id === topic || item.command === (alias[topic] || topic));
  if (/^(masuk|keluar)$/.test(text)) return undefined;
  if (!entry) return undefined;
  return [
    `🔎 *${entry.title}*`, entry.description, '',
    'Contoh:', entry.example,
    ...(entry.extra ? [entry.extra] : []), '',
    'Ketik menu untuk pilihan lainnya.',
  ].join('\n');
}

export function displayText(value, limit = 120) {
  const text = String(value ?? '').replace(/[\r\n\t*_~`\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, limit) : '-';
}
