# Gambar dalam sel Katalog

Tab Product Catalog tetap memakai Link Img. Tab Jika tidak ada di katalog dapat
memakai CellImage.getContentUrl() dari Apps Script, tanpa menyalin atau mengedit
spreadsheet sumber dan tanpa mengunduh workbook Excel yang besar.

## Pemasangan satu kali

1. Buka https://script.google.com/home/start dengan akun Google yang bisa membaca
   spreadsheet KATALOG UPDATE. Buat proyek **standalone** baru; tidak perlu membuka
   Extensions pada spreadsheet sumber.
2. Ganti isi Code.gs dengan `scripts/google-apps-script/catalog-cell-images.gs`.
3. Buka Project Settings → Script Properties. Tambahkan `WMS_CATALOG_SECRET` dengan
   nilai acak minimal 32 karakter dari password manager. Simpan nilai ini secara
   pribadi; jangan memasukkannya ke repository atau membagikannya di chat.
4. Deploy → New deployment → Web app. Pilih **Execute as: Me** dan **Who has access:
   Anyone**. Setujui akses baca spreadsheet pada akun tersebut. Script memeriksa
   secret sebelum membaca data; GET biasa tidak menampilkan katalog atau gambar.
5. Salin URL deployment yang berakhir `/exec`.
6. Pada Cloudflare Pages → proyek WMS → Settings → Variables and Secrets →
   Production, tambahkan:
   - `CATALOG_CELL_IMAGES_URL`: URL `/exec` tadi (variabel server).
   - `CATALOG_CELL_IMAGES_SECRET`: secret yang sama dengan langkah 3, sebagai secret.
7. Redeploy production, lalu buka Katalog → Refresh. Nama dan posisi baris harus
   cocok sebelum gambar ditempelkan ke produk. Perubahan gambar terbaca paling
   lambat sekitar dua menit karena cache.

Jika kebijakan Google Workspace melarang web app “Anyone”, jangan menjadikan
spreadsheet publik. Integrasi ini membutuhkan metode deployment lain yang
memungkinkan server WMS mengakses script; laporkan pembatasan tersebut.

## Perilaku dan diagnosis

- Script hanya membaca spreadsheet ID dan sheet ID yang ditetapkan dalam kode;
  tidak menerima ID atau rentang spreadsheet dari pemanggil.
- Kolom B berisi nama, kolom C berisi gambar dalam sel. Gambar di atas grid
  merupakan tipe berbeda; jangan menganggapnya CellImage.
- Secret tetap berada di server dan Script Properties. Browser hanya mengambil
  raster melalui endpoint `/api/catalog-image` yang memerlukan login WMS.
- URL Google yang sementara tidak disimpan permanen dan tidak dikirim ke browser.
- Jika konfigurasi script tersedia, katalog tidak mengekspor XLSX. Link Img pada
  sumber utama tetap dipakai langsung.
- Jika gagal, halaman menampilkan alasan konfigurasi/akses; produk dan teks tetap
  tampil. Jangan menyatakan gambar berhasil sebelum memeriksa sheet asli setelah
  script terpasang.
- Membuka URL `/exec` langsung menampilkan `POST_REQUIRED` dan itu normal. WMS
  mengaksesnya dengan POST dan secret. Setelah mengubah kode Apps Script, perbarui
  deployment web app agar menggunakan versi terbaru.
