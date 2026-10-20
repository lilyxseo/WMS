# Kontrol spreadsheet pada tabel editable

Berlaku untuk Barang Masuk/Keluar, Asset Store, kolom editable Balikan Store, history Movement/Cycle Count, input sesi, dan preview import PDF. Form Input tetap menggunakan grid khususnya sendiri.

- Klik sel untuk memilih; Enter, F2, atau klik dua kali untuk mengedit. Ketik langsung untuk mengganti isi.
- Arrow/Tab berpindah sel. Shift+Arrow atau Shift+klik memilih rentang; drag juga didukung.
- Shift+Spasi memilih baris; Ctrl+Spasi memilih kolom, mencakup data pada halaman yang tampil. Keduanya juga tersedia pada tabel baca saja (klik sel dulu), serta Form Input. Saat mengetik teks di editor tabel biasa, spasi tetap menjadi teks.
- Ctrl+Arrow melompat ke batas data; Ctrl+Shift+Arrow memperluas rentang. Home/End dan Ctrl+Home/End tersedia.
- Ctrl+C/X/V menyalin, memotong, dan menempel TSV pada halaman yang terlihat.
- Ctrl+D mengisi dari atas; Ctrl+R mengisi dari kiri. Ctrl+Enter menerapkan nilai editor ke rentang.
- Delete/Backspace mengosongkan sel editable yang dipilih.
- Ctrl+Z/Y membatalkan/mengulang perubahan draf per operasi, bukan per huruf. Riwayat draf dihapus setelah penyimpanan.
- Escape membatalkan editor. Tombol Batalkan membuang draf tabel setelah konfirmasi.

Perubahan belum masuk database sebelum **Simpan perubahan** atau Ctrl+S. Pada tabel sesi gunakan **Terapkan**, lalu konfirmasi pengiriman transaksi dengan alur sesi yang sudah ada. Preview PDF tetap perlu diimpor terpisah. Maksimal 1000 sel berubah per tabel; paste yang melewati halaman atau memasuki kolom read-only ditolak seluruhnya. Rumus tidak dievaluasi.

Draf melekat pada identitas baris/kolom, bukan hanya posisi visual. Pergantian akun menghapus draf; browser meminta konfirmasi saat reload/keluar jika ada perubahan. Draf grid tidak disimpan secara permanen. Kolom otomatis dan akses read-only tidak mendapatkan hak tulis baru.

Penyimpanan memakai endpoint dan validasi yang sudah ada. Respons sukses dikonfirmasi per unit simpan, sehingga perubahan yang telah berhasil tidak dikirim ulang otomatis ketika unit berikutnya gagal. Tabel dapat tersimpan sebagian; periksa pesan status dan data sebelum mencoba lagi. Pemeriksaan sumber di browser bukan transaksi atomik lintas pengguna; Asset Store juga mempertahankan pemeriksaan original-row di server.

Barang Masuk/Keluar pada detail SKU juga memakai grid yang sama. Referensi baris disediakan terpisah dari kolom tampilan. Simpan melalui endpoint transaksi yang sudah ada, dengan pemeriksaan SKU, lokasi dan nilai sebelum edit terhadap Google Sheets. Data yang berubah ditolak; qty ringkasan dan tabel detail diperbarui setelah respons simpan sukses. Jika SKU transaksi diubah, baris itu dikeluarkan dari detail SKU sebelumnya. Sinkronisasi sumber transaksi dijalankan sesudah penyimpanan.

Input native lama pada tabel sesi/history berfungsi sebagai backing metadata tersembunyi; tampilan sel menggunakan nilai teks dan satu editor grid penuh saat mengedit. To dan Qty/Stok Aktual tidak lagi memakai dua input yang bertumpuk.
