# Form Input

Buka **Data → Form Input** atau tombol **Form Input** di halaman Barang Masuk/Keluar. Form menggantikan form satu barang lama pada `/sheet-input`; ledger spreadsheet tetap menjadi tujuan transaksi.

- Kolom: Tanggal, From, To, SKU, Nama barang, Qty, Status, PIC, Keterangan.
- Ketik SKU/nama lalu pilih saran. Nama barang mengikuti Kartu Stok; SKU yang sama pada beberapa lokasi hanya satu pilihan.
- Tanggal hari ini (WIB) langsung tampil tanpa jam. From dan To kosong tanpa nilai default. PIC dari `APP_CONFIG.PIC_BY_ROLE`. Semuanya dapat diganti per baris seperti form spreadsheet.
- Status `Barang Masuk` memakai `RECEIPT`; `Barang Keluar` memakai `PENGELUARAN`. Keterangan mengikuti perubahan Status.
- Ctrl+panah melompat ke ujung blok data, sel terisi berikutnya setelah celah, atau batas grid. Tab/Shift+Tab berpindah antar kolom; panah atas/bawah antar baris. Panah kiri/kanan di ujung teks berpindah kolom. Enter turun, Shift+Enter naik. Dropdown Status, PIC, dan Keterangan bisa dicari dengan mengetik, misalnya `KE` untuk Barang Keluar. Alt+panah bawah/tombol ▾ membuka daftar; panah/Enter/Tab memilih dan Escape membatalkan pencarian. Saat saran barang terbuka, panah/Enter memilih saran dan Escape menutupnya.
- Shift+panah memilih rentang sel; Ctrl+Shift+panah memperluas rentang sampai batas data. Ctrl+D mengisi ke bawah dari baris teratas; Ctrl+R mengisi ke kanan dari kolom paling kiri. Pada satu sel, Ctrl+D/Ctrl+R menyalin dari sel di atas/kiri. Ctrl+C menyalin rentang sebagai TSV.
- Ctrl+Z membatalkan perubahan draft; Ctrl+Y/Ctrl+Shift+Z mengulanginya. Satu kali paste atau fill adalah satu langkah. Riwayat Undo/Redo berlaku selama halaman terbuka dan direset setelah transaksi berhasil disimpan; tidak membatalkan transaksi di ledger.
- Paste blok TSV dari spreadsheet dimulai di sel aktif. Maksimal 100 baris per penyimpanan. Baris kosong diabaikan, baris yang sudah diubah wajib lengkap.
- Tombol Simpan menampilkan tinjauan total sebelum menulis. Draft tersimpan per akun/browser dan tetap ada setelah refresh.

## Penyimpanan

Endpoint `/api/stock-entry` memakai identitas sesi terverifikasi, izin PIC/Developer, dan Gmail OAuth server yang sama dengan CRUD aplikasi. SKU/nama diverifikasi ulang terhadap Kartu Stok. Data dikirim ke tab Barang Masuk/Barang Keluar di `SHEET_ID_2026` sesuai Status; alias tab lama `Barang KeIuar` didukung. Tidak ada stok yang diubah langsung.

Google batch tunggal menyisipkan baris pada posisi kosong pertama berdasarkan A:F, mengisi A:I, dan menyimpan receipt developer metadata. Penyisipan menggeser baris yang ada agar transaksi penulis lain tidak tertimpa. Angka SKU disimpan sebagai teks, tanggal sebagai nilai tanggal spreadsheet tanpa jam, dan teks tidak dieksekusi sebagai formula. Nilai dropdown/formula G:P pada baris kosong tidak membuat transaksi baru meloncat ke akhir tab.

Tabel privat `stock_entry_batches` mencatat pemilik, nama/role penulis, hash input, dan status request. RLS melarang akses langsung anon/authenticated; hanya server yang menulis receipt. ID dan fencing token mencegah pengiriman ganda. Jika hasil Google tidak diketahui, input dikunci dan **Periksa status** mencari receipt tanpa mengulang transaksi. Jika receipt belum ditemukan, periksa ledger sebelum membuat transaksi baru. Bukti simpan tidak boleh dihapus tanpa rekonsiliasi.

Sesudah sukses, form dibersihkan dan sumber ledger terkait disinkronkan ke WMS. Kegagalan sinkronisasi tidak mengulang transaksi Google.

## Deploy dan validasi

Workflow `deploy-stock-entry.yml` menerapkan migration receipt dan memverifikasi RLS. Tidak mengubah baris inventory/ledger. Unit test baru memakai mock; pengujian browser juga tidak menulis transaksi nyata. OAuth harus memiliki izin spreadsheet dan akun Gmail harus Editor pada Spreadsheet 2026.
