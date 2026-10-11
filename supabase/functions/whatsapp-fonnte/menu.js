// Register every new search command here: menus and command guidance use this list.
export const SEARCH_MENU = Object.freeze([
  { id: '1', command: 'sku', title: 'Cari SKU', description: 'Cari sebagian kode SKU, termasuk nol di depan.', example: 'sku ABC123' },
  { id: '2', command: 'barang', title: 'Cari nama barang', description: 'Cari satu atau beberapa kata pada nama barang.', example: 'barang kabel usb' },
  { id: '3', command: 'lokasi', title: 'Cari lokasi', description: 'Lihat stok yang tercatat pada lokasi tertentu.', example: 'lokasi A-01' },
  { id: '4', command: 'detail', title: 'Detail SKU', description: 'Cari kode SKU persis, tanpa membedakan kapitalisasi.', example: 'detail ABC123' },
  { id: '5', command: 'cari', title: 'Pencarian gabungan', description: 'Gabungkan kata bebas atau filter beberapa kolom.', example: 'cari nama=kabel; lokasi=A-01', extra: 'cari kabel A-01' },
]);

export function renderMenu(entries = SEARCH_MENU) {
  return [
    '📦 *WMS • Pusat Pencarian Stok*',
    'Temukan barang berdasarkan SKU, nama, atau lokasi.',
    '',
    '*Pilih cara pencarian*',
    ...entries.flatMap(item => [`*${item.id}. ${item.title}*`, item.description, `Contoh: ${item.example}`, '']),
    '*Persempit hasil*',
    'Tambahkan filter setelah titik koma:',
    '• sumber=Kartu Stock / RPL / BULKY',
    '• stok=ada / kosong / semua',
    '• halaman=2 untuk melanjutkan hasil',
    'Contoh: barang kabel; sumber=RPL; stok=ada',
    '',
    '*Cara menggunakan menu*',
    `Kirim nomor ${entries.map(item => item.id).join(', ')} untuk petunjuk, atau langsung kirim contoh perintah.`,
    'Ketik menu kapan saja untuk kembali.',
    '',
    'ℹ️ Data mengikuti sinkronisasi terakhir WMS. Stok setiap sumber ditampilkan terpisah.',
  ].join('\n');
}

export function resolveMenu(message) {
  const text = String(message ?? '').trim().toLowerCase();
  if (!text || /^(menu|help|bantuan|mulai|start|halo|hai)$/i.test(text)) return renderMenu();
  const topic = text.replace(/^(menu|help|bantuan)\s+/, '');
  const entry = SEARCH_MENU.find(item => item.id === topic || item.command === topic);
  if (!entry) return undefined;
  return [
    `🔎 *${entry.title}*`, entry.description, '',
    '*Kirim perintah berikut, ganti nilainya:*', entry.example,
    ...(entry.extra ? [entry.extra] : []), '',
    '*Filter opsional*', `${entry.example}; sumber=RPL; stok=ada`, '',
    'Hasil berisi SKU, nama barang, lokasi, stok, dan sumber.',
    'Salin perintah navigasi dari balasan untuk pindah halaman.',
    'Ketik menu untuk melihat semua pilihan.',
  ].join('\n');
}

export function displayText(value, limit = 120) {
  const text = String(value ?? '').replace(/[\r\n\t*_~`\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, limit) : '-';
}
