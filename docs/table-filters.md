# Filter kolom tabel

Setiap tabel data memakai menu kolom dari `assets/js/table-filters.js`. Header mengikuti aksen aktif pada tema terang maupun gelap. Kolom aksi, nomor baris Form Input dan checkbox pilih-semua tidak mempunyai filter.

Menu menyediakan urut naik/turun, pencarian nilai, checkbox nilai (termasuk kosong), pilih semua/kosongkan, filter kondisi teks/angka, Terapkan, Batal, serta hapus filter. Beberapa filter kolom digabung dengan AND. Mengosongkan seluruh pilihan berarti menampilkan nol baris; berbeda dengan menghapus filter. Nilai yang tidak ditemukan di pencarian tidak otomatis dibuang. Daftar menampilkan sampai 250 nilai sekaligus; pencarian tetap memeriksa semua nilai yang tersedia.

Cakupannya **data pada halaman tabel yang sedang ditampilkan**, bukan seluruh database. Menu dan ringkasan hasil selalu menjelaskan cakupan ini. Pencarian halaman/API yang sudah ada tetap dipakai untuk mencari seluruh data. Filter per kolom diterapkan kembali saat tabel dirender ulang atau berganti halaman; filter tidak disimpan antarlogin. Reset Filter pada halaman juga membersihkan filter bersama. Ekspor halaman tetap memakai alur ekspor aplikasi yang sudah ada.

Filter dan sort hanya mengubah tampilan, tidak menulis atau mengurutkan ulang Google Sheets/database. Identitas sumber tiap baris tetap utuh. Navigasi dan seleksi pada tabel editable serta Form Input mengikuti baris yang terlihat; fill, hapus, salin, paste melewati baris tersembunyi. Paste yang melewati kapasitas tampilan terfilter dibatalkan. Pengiriman Form Input tetap mengikuti tinjauan seluruh draft dan tombol konfirmasi yang sudah ada.

Cari Data memulihkan hasil terakhir, source dan pagination saat kembali dari detail SKU. Jika query/source berubah atau belum selesai dimuat, pencarian dijalankan kembali. Hasil kosong yang sudah selesai dimuat juga dipulihkan sebagai hasil kosong.
