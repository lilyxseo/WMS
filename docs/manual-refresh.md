# Refresh inventory

Refresh tetap membaca Google Sheets terbaru. Endpoint manual memakai checksum
terverifikasi untuk melewati pemindaian penuh pada sumber yang belum berubah;
perubahan isi, sumber yang belum terbukti bersih, dan rekonsiliasi berkala tetap
membaca metadata lengkap. `?full=1` tersedia pada endpoint per sumber untuk
rekonsiliasi penuh yang disengaja, dengan autentikasi yang sama.

Browser menjalankan pekerjaan sumber secara berurutan untuk membatasi tekanan
memori Worker dan request upstream. Panggilan bersamaan untuk sumber dan sesi
yang sama berbagi pekerjaan. Kegagalan sementara dicoba paling banyak tiga kali;
header/konfigurasi yang salah tidak diulang tanpa batas.

Jika sumber sedang dikunci pekerjaan lain, browser memantau status server.
Sukses hanya diterima setelah sumber berstatus success, kuncinya dilepas, dan
waktu commit berubah dari baseline. Status success lama bukan bukti bahwa request
yang gagal telah selesai. Lock yang masih aktif dilaporkan pending; kegagalan
nyata tetap ditampilkan. Watcher versi yang sudah ada menerapkan commit baru
setelah selesai tanpa reload halaman. Request database diberi timeout agar
koneksi yang macet tidak menggantungkan proses tanpa batas.
