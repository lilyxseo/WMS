// Register every new search command here: menus and command guidance use this list.
export const SEARCH_MENU = Object.freeze([
  { id: '1', command: 'cari', title: 'Pencarian global', description: 'Cari SKU, nama, dan lokasi hanya di Kartu Stok. Gabungkan nama dan lokasi; pisahkan beberapa pencarian dengan koma.', example: 'cari merlyn a20-1', extra: 'cari 8844,2299,3399,merlyn white,merlyn gold' },
  { id: '2', command: 'masuk', title: 'Barang masuk', description: 'Cari data penerimaan berdasarkan barang, lokasi, tanggal, PIC, dokumen, atau jumlah.', example: 'masuk kabel', extra: 'masuk' },
  { id: '3', command: 'keluar', title: 'Barang keluar', description: 'Cari data pengeluaran berdasarkan barang, lokasi, tanggal, PIC, dokumen, atau jumlah.', example: 'keluar ABC123', extra: 'keluar' },
  { id: '4', command: 'edit', title: 'Edit transaksi', description: 'Cari barang masuk/keluar, pilih edit 1, lalu ikuti panduan kolom dan konfirmasi simpan. Khusus nomor editor.', example: 'edit 1', extra: 'masuk merlyn' },
  { id: '5', command: 'movement', title: 'Movement', description: 'Pindahkan barang: cari, pilih asal, isi tujuan, jumlah dan PIC, lalu konfirmasi. Khusus nomor editor.', example: 'movement merlyn a20-1', extra: 'movement' },
  { id: '6', command: 'inbound', title: 'Inbound', description: 'Cari barang, isi From, To dan qty, lalu konfirmasi. PIC otomatis dari konfigurasi role.', example: 'inbound merlyn', extra: 'inbound' },
  { id: '7', command: 'outbount', title: 'Outbount', description: 'Cari barang, isi lokasi asal dan qty, lalu konfirmasi. Stok diperiksa dan PIC otomatis dari konfigurasi role.', example: 'outbount merlyn a20-1', extra: 'outbount' },
  { id: '8', command: 'cek google', title: 'Cek Google', description: 'Periksa autentikasi dan akses spreadsheet tanpa membuat transaksi.', example: 'cek google' },
]);

export function renderMenu(entries = SEARCH_MENU) {
  return [
    '📦 *Menu WMS*', '',
    ...entries.flatMap(item => [`*${item.id}. ${item.title}*`, `Contoh: ${item.example}`, '']),
    'Kirim pencarian langsung atau nomor menu untuk panduan.',
    'Navigasi: lanjut • sebelumnya • menu',
  ].join('\n');
}

export function isMainMenu(message) {
  const text = String(message ?? '').trim().toLowerCase();
  return !text || /^(menu|help|bantuan|mulai|start|halo|hai|selamat (pagi|siang|sore|malam))$/.test(text);
}

export function resolveMenu(message) {
  const text = String(message ?? '').trim().toLowerCase();
  if (isMainMenu(text)) return renderMenu();
  const topic = text.replace(/^(menu|help|bantuan)\s+/, '');
  const alias = { sku: 'cari', barang: 'cari', lokasi: 'cari', detail: 'cari', 'stock in': 'inbound', 'stok in': 'inbound', 'stock out': 'outbount', 'stok out': 'outbount', outbound: 'outbount' };
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
