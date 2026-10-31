# Error browser dan jejak penggunaan

Browser mengirim batch ke `POST /api/client-events`. Data masuk ke tabel Supabase `activity_logs` yang sudah ada; tidak perlu tabel baru. Identitas user/nama/role diverifikasi server, bukan diambil dari klaim dalam payload browser.

Pada **Log Aktivitas → Login, navigasi & aktivitas**, gunakan filter:

- `CLIENT_ERROR`: `console.error`, exception tidak tertangani, promise rejection dan resource gagal dimuat. Detail mencakup halaman, pesan, stack yang tersedia, file/baris/kolom.
- `LOGIN` / `AUTO_LOGIN`: dicatat lewat endpoint sesi terverifikasi setelah profil siap; satu per generasi sesi.
- `PAGE_VIEW`: halaman awal setelah login, navigasi aplikasi, Back/Forward; render ulang halaman yang sama tidak menggandakan catatan.
- `UI_ACTION`: klik tombol/link, perubahan pilihan/input setelah selesai mengedit, serta submit form. Nilai input, password, nama/isi file dan isi clipboard tidak dikirim.
- `API_REQUEST`: operasi baca dan perubahan data pada API beserta endpoint, method, HTTP status, durasi dan hasil. Kegagalan logis (`success:false` atau item gagal) juga ditandai gagal meskipun HTTP 200. Polling versi/status dan penyimpanan draft otomatis tidak menghasilkan log sukses berulang.

Audit transaksi server di tab **Transaksi & sinkronisasi** tetap menjadi bukti penyimpanan dan perubahan sebelum/sesudah. Telemetri browser memakai `source:CLIENT_TELEMETRY` dan `verified:false`; klik Simpan sendiri bukan bukti CRUD berhasil.

Pengiriman tidak memblokir respons API, dibatasi ukuran dan jumlah batch, retry bertahap hingga jeda 60 detik, serta memisahkan sesi akun. Login/navigasi dikirim segera; membuka riwayat menunggu flush yang sedang berjalan. Error identik dibatasi satu catatan per 30 detik. Endpoint log tidak merekam permintaannya sendiri. Antrean maksimal 100 event disalin ke sessionStorage per akun (maksimal usia 24 jam), termasuk batch yang sedang dikirim. Reload pada tab yang sama memulihkan event yang belum diakui server. Penutupan tab, quota storage, antrean melebihi batas, atau kegagalan script sebelum pemantau terpasang masih dapat menyebabkan event hilang. Pencatatan browser tetap bersifat best effort, bukan bukti transaksi server.

Token, cookie, kredensial, query URL dan data file disensor di client dan server. Error sebelum ada sesi login tidak dikirim. Database menyimpan waktu penerimaan server dan waktu kejadian browser terpisah. Reference event dipakai untuk menghindari duplikasi retry (best effort).

## Membaca error untuk diagnosis

Gunakan akses WMS Developer/PIC Inventory yang sudah diotorisasi: `GET /api/activity-log?action=CLIENT_ERROR&limit=25` dengan header Authorization sesi. Endpoint yang sama mendukung `from`, `to`, `module`, `search`, dan `offset`. Atau baca `activity_logs` melalui akses database yang diberikan untuk sesi Codex. Secret tidak boleh ditempel di percakapan/repository. Tersimpannya log tidak otomatis memberikan Codex akses produksi; akses dan jaringan tetap harus tersedia saat diagnosis.

## Edit ditahan sebelum data dikirim

Middleware transaksi membedakan tahap `identity`, `register`, `snapshot`, dan `checkpoint` melalui respons `AUDIT_PRECHECK_FAILED`. `dataNotSent:true` berarti handler perubahan belum dijalankan. Error sementara (timeout, jaringan, 429/5xx) mendapat satu retry pada pembacaan/pencatatan audit; insert awal memakai UUID yang sama dan `on_conflict=id` dengan `ignore-duplicates`, sehingga respons insert yang hilang tidak membuat log kedua. Snapshot harus tetap tersedia sebelum edit diteruskan. Operasi perubahan barang tidak otomatis diulang. Jika audit tetap gagal, perubahan ditahan dan form tetap bisa diperiksa/dicoba kembali. Error konfigurasi/validasi tidak diulang otomatis.

Filter login/navigasi otomatis memilih feed history. Tab transaksi tetap membaca `wms_operations`; riwayat pengguna membaca `activity_logs`. Nama/ID/role untuk event baru berasal dari server. Endpoint browser menerima LOGIN/AUTO_LOGIN hanya dari sesi yang valid, dan event tetap diberi `verified:false` sebagai laporan client.
