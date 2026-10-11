// Register every new search command here: menus and command guidance use this list.
export const SEARCH_MENU = Object.freeze([
  { id: '1', command: 'cari', title: 'Pencarian global', description: 'Cari SKU, nama, dan lokasi hanya di Kartu Stok. Contoh gabungan: merlyn a20-1.', example: 'cari merlyn a20-1', extra: 'merlyn 6840' },
  { id: '2', command: 'masuk', title: 'Barang masuk', description: 'Cari data penerimaan berdasarkan barang, lokasi, tanggal, PIC, dokumen, atau jumlah.', example: 'masuk kabel', extra: 'masuk' },
  { id: '3', command: 'keluar', title: 'Barang keluar', description: 'Cari data pengeluaran berdasarkan barang, lokasi, tanggal, PIC, dokumen, atau jumlah.', example: 'keluar ABC123', extra: 'keluar' },
]);

export function renderMenu(entries = SEARCH_MENU) {
  return [
    '📦 *WMS • Pencarian & Transaksi*',
    'Langsung kirim kata pencarian; tidak perlu memilih jenis SKU/nama/lokasi.',
    'Contoh: merlyn green gold atau merlyn 6840.',
    'Semua kata dicari dengan aturan mengandung; tidak harus berurutan.',
    'Global hanya mengambil Kartu Stok, 10 hasil per halaman.',
    'Stok 0 disembunyikan; balas y/n pada pertanyaan untuk mengubahnya.',
    '',
    '*Pilih cara pencarian*',
    ...entries.flatMap(item => [`*${item.id}. ${item.title}*`, item.description, `Contoh: ${item.example}`, '']),
    '*Persempit hasil*',
    'Tambahkan filter setelah titik koma:',
    '• sumber=Kartu Stock / Barang Masuk / Barang Keluar',
    '• stok=ada / kosong / semua',
    '• navigasi: balas lanjut atau sebelumnya',
    '• transaksi: tanggal=, status=, pic=, dokumen=, jumlah=',
    'Contoh: cari merlyn; stok=ada',
    '',
    '*Cara menggunakan menu*',
    `Kirim nomor ${entries.map(item => item.id).join(', ')} untuk petunjuk, atau langsung kirim contoh perintah.`,
    'Ketik menu kapan saja untuk kembali.',
    '',
    'ℹ️ Data mengikuti sinkronisasi WMS. Filter stok hanya mencari sumber stok. Transaksi dicari dari baris terbaru sampai hasil ditemukan atau data habis.',
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
    '*Kirim perintah berikut, ganti nilainya:*', entry.example,
    ...(entry.extra ? [entry.extra] : []), '',
    '*Filter opsional*', entry.command === 'cari' ? `${entry.example}; stok=ada` : 'Balas lanjut untuk halaman berikutnya.', '',
    'Hasil stok memuat lokasi dan stok; transaksi memuat tanggal, asal/tujuan, jumlah, status, dan PIC.',
    'Cukup balas lanjut atau sebelumnya untuk pindah halaman.',
    'Ketik menu untuk melihat semua pilihan.',
  ].join('\n');
}

export function displayText(value, limit = 120) {
  const text = String(value ?? '').replace(/[\r\n\t*_~`\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, limit) : '-';
}
