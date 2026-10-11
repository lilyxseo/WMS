# Bot WhatsApp WMS (Fonnte)

Webhook Supabase Edge Function: `POST /functions/v1/whatsapp-fonnte`.
Bot mencari data Supabase pada `inventory_kartu_stok`, `inventory_rpl`, dan
`inventory_bulky`, serta transaksi `inventory_barang_masuk` dan
`inventory_barang_keluar`, lalu mengirim balasan lewat `https://api.fonnte.com/send`.
Tidak ada penulisan database atau sinkronisasi inventory dari webhook ini.

## Konfigurasi

Atur nilai berikut melalui Supabase Dashboard → Edge Functions → Secrets:

- `FONNTE_TOKEN`: token perangkat Fonnte; simpan sebagai secret.
- `FONNTE_WEBHOOK_SECRET`: secret acak yang kuat; simpan sebagai secret.
- `WHATSAPP_ALLOWED_NUMBERS`: nomor yang boleh mencari inventory, dipisahkan
  koma, misalnya `6281234567890,6289876543210`. Nomor berawalan `0` dinormalisasi
  menjadi `62`. Semua nomor harus memakai format Indonesia/internasional.
- `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` tersedia otomatis pada runtime
  Supabase Edge Functions. Bot memakai key server ini hanya untuk membaca stok.
- Opsional: `WMS_SUPABASE_SECRET_KEY` untuk menggunakan secret key baru
  (`sb_secret_...`) milik proyek WMS sebagai pengganti service-role bawaan.
  Nama ini memakai prefiks WMS karena custom secret berprefiks SUPABASE
  tidak dapat diatur melalui Supabase secrets.

Daftarkan URL webhook pada perangkat Fonnte:
`https://<project-ref>.supabase.co/functions/v1/whatsapp-fonnte?secret=<FONNTE_WEBHOOK_SECRET>`.
Perlakukan URL lengkap sebagai rahasia; jangan masukkan ke Git atau log.
Header `X-Webhook-Secret` juga didukung jika pengirim webhook dapat mengaturnya.
Secret ini adalah pemeriksaan akses aplikasi, bukan tanda tangan resmi Fonnte.
Nomor di luar allowlist dan pesan grup diabaikan. Tanpa konfigurasi wajib,
webhook mengembalikan 503 dan tidak membaca database.

Deploy dari root repositori, setelah login CLI Supabase:

```sh
supabase functions deploy whatsapp-fonnte --project-ref <project-ref> --no-verify-jwt
```

Gunakan project ref Supabase WMS yang tabel inventory-nya sudah tersedia.
Konfigurasi `supabase/config.toml` menonaktifkan verifikasi JWT hanya untuk
fungsi ini, karena webhook Fonnte tidak membawa JWT pengguna Supabase.
Secret webhook dan allowlist nomor tetap wajib diperiksa di handler.
Endpoint Cloudflare bot sebelumnya sudah dihapus; API WMS lainnya tetap ada.

Untuk menjalankan lokal dengan CLI Supabase dan Docker:

```sh
supabase functions serve whatsapp-fonnte --env-file /tmp/wms-bot.env --no-verify-jwt
```

File env di luar repositori harus memuat secret bot, allowlist, URL database,
dan `WMS_SUPABASE_SECRET_KEY` bila menggunakan database WMS remote. File tidak
boleh dikomit atau dicetak ke log. Tanpa Docker, handler dapat dijalankan
langsung dengan Deno:

```sh
deno run --allow-net --allow-env --env-file=/tmp/wms-bot.env supabase/functions/whatsapp-fonnte/index.ts
```

Jangan menyimpan token dalam source. Izinkan egress menuju `api.fonnte.com`
dan hostname proyek Supabase untuk pengembangan di lingkungan cloud.

## Pencarian dan menu

Ketik `menu`, `bantuan`, atau `halo`. Menu memiliki tiga fitur: pencarian global,
barang masuk, dan barang keluar. Nomor 1–3 membuka panduan, bukan memilih hasil.
Menu dan panduan dihasilkan dari `SEARCH_MENU` di `menu.js`; fitur baru wajib
menambah registry, implementasi, dan tes sekaligus.

Pencarian global **hanya membaca `inventory_kartu_stok`**. Langsung kirim:

- `merlyn green gold`: semua kata harus mengandung pada baris yang sama.
- `merlyn 6840`: nama/SKU mengandung merlyn dan akhiran SKU mengandung 6840.
- `merlyn a20-1`: nama/SKU mengandung merlyn dan lokasi mengandung a20-1.
- `cari nama=merlyn; lokasi=a20-1`: filter terstruktur pada kolom tertentu.
- `sku ABC123`, `barang merlyn`, `lokasi A20-1`, `detail ABC123`: alias tetap ada;
  detail memakai SKU persis tanpa membedakan kapitalisasi.

Global menampilkan **10 baris per halaman**, disertai perintah halaman berikut
atau sebelumnya. Balas `lanjut` untuk halaman berikutnya dan `sebelumnya` untuk kembali,
tanpa simbol atau menyalin query. Tidak ada batas jumlah halaman bisnis. Nilai negatif tetap ditampilkan.
Default stok 0 disembunyikan. Setelah hasil, bot bertanya:

```text
Tampilkan stok 0? y/n
```

- `y`: ulang pencarian terakhir dari halaman 1, tampilkan stok 0 serta stok lain.
- `n`: ulang pencarian terakhir dari halaman 1, sembunyikan stok 0.
- Balasan `lanjut`/`sebelumnya` mempertahankan pilihan `y`.

Konteks disimpan per nomor WhatsApp dalam `whatsapp_search_sessions` dengan
masa berlaku 15 menit. Pencarian baru menggantikan konteks sebelumnya. Pencarian barang masuk/keluar juga disimpan; navigasi selalu mengikuti
pencarian terakhir, baik stok maupun transaksi. `y/n` hanya berlaku saat
konteks terakhir adalah pencarian stok. Nomor lain tidak dapat
memakai konteks pengguna. RLS aktif; hanya role server yang memperoleh akses.
Tidak ada data hasil atau kredensial yang disimpan; hanya nomor, perintah/filter,
dan waktu kedaluwarsa. Baris kedaluwarsa tidak dibaca; baris pengguna diperbarui
saat pencarian berikutnya, bukan otomatis dihapus oleh scheduler.

`masuk kabel` / `keluar ABC123` mencari transaksi masing-masing. `masuk` /
`keluar` tanpa kata menampilkan transaksi baris terbaru. Hasil tetap 3 transaksi
per halaman. Filter transaksi mendukung nama, SKU, lokasi, tanggal, PIC, status,
dokumen, dan jumlah. Jumlah memakai pencocokan teks; 12 bisa cocok dengan 120.
Pencarian transaksi tidak dibatasi 5.000 baris. Database dibaca dalam batch
1.000 baris hingga halaman dan satu hasil berikutnya ditemukan atau data habis.
Hanya empat hasil transaksi ditahan dalam memori. Query tanpa kata pencarian
membaca halaman langsung dengan offset. Pencarian langka pada riwayat besar
dapat membutuhkan lebih banyak waktu; kegagalan dibalas sebagai kegagalan,
bukan hasil kosong. Urutan mengikuti baris sumber, bukan tanggal
teks campuran. Jumlah transaksi tidak dijumlahkan sebagai saldo stok.

Balasan tidak menampilkan kolom Dokumen (link) atau label Sumber pada kartu
maupun ringkasan hasil. Dokumen tetap dapat dipakai sebagai kata/filter pencarian.
Waktu sinkronisasi hasil stok ditampilkan dalam WIB. Query halaman baru bisa
bergeser jika database berubah. Pencarian global tidak membaca RPL, BULKY,
barang masuk, atau barang keluar. Gunakan fitur transaksi khusus untuk ledger.
CRUD movement dan cycle count belum ditambahkan.

## Validasi

Jalankan `node --test tests/whatsapp-fonnte.test.mjs` atau seluruh suite
`node --test tests/*.test.mjs`. Tes menggunakan respons Supabase/Fonnte tiruan.
Setelah deploy, kirim `bantuan`, SKU yang diketahui, nama, lokasi, dan SKU
yang tidak ada dari nomor yang diizinkan. Bandingkan hasil dengan WMS dan
pastikan nomor lain tidak menerima data. Pastikan perangkat Fonnte terhubung.

Integrasi nyata belum diverifikasi tanpa kredensial/perangkat. Dokumentasi
Fonnte tidak dapat diakses dari lingkungan onboarding (HTTP 403); pastikan
payload webhook perangkat memuat `sender` dan `message`, serta API pengiriman
mengembalikan JSON `status: true`. Callback duplikat dapat menghasilkan balasan
duplikat; idempotensi lintas request dan pembatasan laju belum diterapkan.
Pengaturan webhook Fonnte dilakukan melalui dashboard Fonnte.

## Deploy otomatis dari GitHub

Workflow `.github/workflows/deploy-whatsapp-supabase.yml` men-deploy fungsi
`whatsapp-fonnte` ke proyek WMS `udullprykzdskrxmbbkj` ketika perubahan fungsi,
konfigurasi Supabase, SQL konteks bot, tes, atau workflow di-push ke branch `work` atau `main`.
Kedua branch menargetkan proyek yang sama. Tombol Run workflow juga tersedia
setelah workflow ada di default branch. Pilih `work` atau `main` saat menjalankannya.

Persiapan satu kali:

1. Buat personal access token di akun Supabase yang memiliki akses ke proyek WMS.
2. Buka GitHub repositori WMS → Settings → Secrets and variables → Actions.
3. Tambahkan repository secret `SUPABASE_ACCESS_TOKEN` dengan token tersebut.
   Token ini berbeda dari Supabase database key maupun token Fonnte.
4. Pastikan secrets bot sudah diatur di Supabase seperti bagian Konfigurasi.

Workflow menjalankan suite tes, pemeriksaan Deno, lalu deploy lewat API Supabase
tanpa Docker. Setelah deploy, request tanpa secret wajib ditolak dengan HTTP
401. Pemeriksaan ini tidak mengirim pesan WhatsApp; status 503 menunjukkan
secrets bot belum lengkap. Jika pemeriksaan terakhir gagal, kode mungkin sudah
ter-deploy; workflow tidak otomatis melakukan rollback.

Secret aplikasi tetap berada di Supabase dan tidak diubah oleh workflow.
Sebelum deploy, workflow menerapkan hanya SQL additive
`20261011070000_whatsapp_search_sessions.sql` lewat Management API Supabase,
memakai access token yang sama. SQL dapat diulang dan hanya menyiapkan tabel
konteks bot serta izin server. Migrasi WMS lain tidak dijalankan. Deployment
berhenti jika pembuatan tabel gagal. Lihat status deployment melalui
tab Actions GitHub, workflow **Deploy WhatsApp bot to Supabase**. Konfigurasi
workflow di Git belum membuktikan deployment berhasil; pastikan run hijau.
