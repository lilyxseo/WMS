# Bot WhatsApp WMS (Fonnte)

Webhook Supabase Edge Function: `POST /functions/v1/whatsapp-fonnte`.
Bot mencari data Supabase pada `inventory_kartu_stok`, serta transaksi `inventory_barang_masuk` dan
`inventory_barang_keluar`, lalu mengirim balasan lewat `https://api.fonnte.com/send`.
Pencarian hanya membaca data. Wizard edit mencerminkan perubahan Google Sheets ke Supabase;
movement dan stock in/out menulis transaksi baru ke Google Sheets setelah konfirmasi.
Webhook tidak memicu sinkronisasi inventory seluruh sumber.

## Konfigurasi

Atur nilai berikut melalui Supabase Dashboard → Edge Functions → Secrets:

- `FONNTE_TOKEN`: token perangkat Fonnte; simpan sebagai secret.
- `FONNTE_WEBHOOK_SECRET`: secret acak yang kuat; simpan sebagai secret.
- `WHATSAPP_ALLOWED_NUMBERS`: allowlist pencarian lama yang opsional; nomor yang
  terdaftar di `users.phone_number` juga boleh membaca data. Allowlist dipisahkan
  koma, misalnya `6281234567890,6289876543210`. Nomor berawalan `0` dinormalisasi
  menjadi `62`. Semua nomor harus memakai format Indonesia/internasional.
- `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` tersedia otomatis pada runtime
  Supabase Edge Functions. Bot memakai key server ini untuk membaca stok/profil dan menyimpan session bot.
- Opsional: `WMS_SUPABASE_SECRET_KEY` untuk menggunakan secret key baru
  (`sb_secret_...`) milik proyek WMS sebagai pengganti service-role bawaan.
  Nama ini memakai prefiks WMS karena custom secret berprefiks SUPABASE
  tidak dapat diatur melalui Supabase secrets.

Daftarkan URL webhook pada perangkat Fonnte:
`https://<project-ref>.supabase.co/functions/v1/whatsapp-fonnte?secret=<FONNTE_WEBHOOK_SECRET>`.
Perlakukan URL lengkap sebagai rahasia; jangan masukkan ke Git atau log.
Header `X-Webhook-Secret` juga didukung jika pengirim webhook dapat mengaturnya.
Secret ini adalah pemeriksaan akses aplikasi, bukan tanda tangan resmi Fonnte.
Nomor di luar allowlist yang tidak terdaftar di profil dan pesan grup diabaikan. Tanpa konfigurasi wajib,
webhook mengembalikan 503 dan tidak membaca database.

Deploy dari root repositori, setelah login CLI Supabase:

```sh
supabase functions deploy whatsapp-fonnte --project-ref <project-ref> --no-verify-jwt
```

Gunakan project ref Supabase WMS yang tabel inventory-nya sudah tersedia.
Konfigurasi `supabase/config.toml` menonaktifkan verifikasi JWT hanya untuk
fungsi ini, karena webhook Fonnte tidak membawa JWT pengguna Supabase.
Secret webhook tetap wajib. Handler memverifikasi nomor lewat allowlist lama atau profil `users.phone_number`.
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

Ketik `menu`, `bantuan`, atau `halo`. Menu memiliki empat fitur: pencarian global,
barang masuk, barang keluar, edit transaksi, movement, stock in, dan stock out.
Nomor 1–8 membuka panduan, bukan memilih hasil saat wizard tidak aktif.
Menu utama ditampilkan ringkas: empat pilihan, contoh, dan satu baris navigasi.
Panduan singkat per fitur tersedia saat nomor menu dikirim.
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
Konteks pencarian stok menyimpan nomor, perintah/filter dan waktu kedaluwarsa.
Konteks transaksi turut menyimpan baris pada halaman terakhir untuk pemilihan
edit. Draft edit menyimpan nilai lama dan baru; kredensial tidak disimpan. Baris kedaluwarsa tidak dibaca; baris pengguna diperbarui
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
Waktu sinkronisasi tidak ditampilkan dalam balasan. Query halaman baru bisa
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

## Edit barang masuk / keluar

Fitur awal ini hanya mengedit transaksi yang sudah ada; tambah/hapus belum
tersedia. Menu otomatis memuat pilihan Edit transaksi dari registry.

Alur:

1. Kirim `masuk merlyn` atau `keluar ABC123`.
2. Balas `edit 1` sesuai nomor hasil di halaman terakhir.
3. Pilih nomor kolom: jumlah, status, PIC, keterangan, asal, tujuan, tanggal,
   SKU, atau nama barang.
4. Kirim nilai baru. Bot menampilkan nilai lama → baru.
5. Balas `simpan`, `ubah` untuk menambahkan kolom lain, atau `batal`.

Jumlah menerima angka 0 atau lebih. Tanggal memakai YYYY-MM-DD. Identitas
transaksi tampil sebelum memilih kolom. Nomor hasil hanya berlaku pada halaman
terakhir; tidak sama dengan nomor baris spreadsheet. Draft kedaluwarsa setelah
15 menit tanpa interaksi. `menu` membatalkan draft yang belum disimpan.

Konfigurasi tambahan di Supabase Edge Function Secrets:

- `WHATSAPP_EDITOR_NUMBERS`: nomor editor yang disetujui, dipisahkan koma.
  Nomor juga harus masuk allowlist pencarian atau terdaftar di `users.phone_number`. Default kosong berarti
  tidak ada nomor yang dapat mengedit; izin pencarian tidak otomatis memberi izin edit.
- `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`: service account Google yang sama
  dengan WMS; spreadsheet harus dibagikan dengan izin editor ke service account.
- `SHEET_ID_2026`: spreadsheet utama transaksi WMS.

Google private key diperlukan untuk signing lokal, sehingga tidak bisa berupa
placeholder proxy. Isi nilainya secara aman pada Secrets Supabase, bukan chat.
Status, PIC, SKU dan lokasi berupa teks sesuai data WMS; belum ada validasi
referensi katalog/user. Tidak ada editor yang diberikan otomatis oleh deploy.

Google Sheets menjadi sumber utama: `Barang Masuk` dan `Barang KeIuar` (huruf I
besar sesuai nama sheet WMS yang dipakai aplikasi). Sebelum menulis, bot
membandingkan kolom A–I dengan snapshot transaksi. Bila data berbeda atau belum
tersinkron, edit ditolak dan pengguna harus mencari ulang setelah sinkronisasi.
Writes memakai RAW untuk mempertahankan teks sebagai teks, bukan formula.

Konfirmasi diklaim secara atomik melalui session nonce/phase di Supabase agar
konfirmasi duplikat tidak melakukan write kedua. Sesudah Sheets tersimpan,
Supabase diperbarui untuk nomor baris tersebut. Jika mirror gagal, bot melaporkan
bahwa Sheets tersimpan tetapi sinkronisasi Supabase masih ditunggu. Jika respons
write Sheets gagal/timeout, hasil dianggap belum pasti; bot meminta pemeriksaan
WMS, bukan mencoba write ulang otomatis. Sheets dan Supabase bukan satu transaksi
atomik. Perubahan Sheets oleh pengguna lain di antara pemeriksaan dan write
masih dapat terjadi; jangan melakukan edit bersamaan pada baris yang sama.

Konteks edit menyimpan snapshot transaksi dan draft perubahan sementara dalam
session yang hanya dapat diakses server. Tidak ada token/private key dalam
session. Pencarian/navigasi tetap read-only. Jangan mengedit data produksi saat
menjalankan tes; suite menggunakan Sheets, Supabase, dan Fonnte tiruan.

## Movement melalui WhatsApp

Menu `5` menampilkan panduan. Kirim `movement` atau langsung `movement merlyn a20-1`.
Bot mencari Kartu Stok dengan stok positif, 10 hasil per halaman. Pilih nomor barang/lokasi asal;
`lanjut` dan `sebelumnya` menavigasi hasil. Isi lokasi tujuan, jumlah, dan PIC. Bot menampilkan
ringkasan; hanya `simpan` pada tahap konfirmasi yang menulis data. `ubah` memulai ulang draft,
`batal` membatalkan, dan `menu` keluar ke menu utama. Draft berlaku 15 menit.

Akses movement menggunakan `WHATSAPP_EDITOR_NUMBERS`; nomor harus masuk allowlist pencarian
atau terdaftar di `users.phone_number`. Stock in/out menggunakan role profil seperti dijelaskan di bawah.
Selain konfigurasi Google untuk edit, tambahkan **`SHEET_ID_INVENTORY`** di Supabase Secrets,
berisi spreadsheet yang mempunyai tab `Movement`. Service account harus mempunyai akses Editor
ke spreadsheet tersebut dan `SHEET_ID_2026`. `BUSINESS_TIME_ZONE` opsional, default `Asia/Jakarta`.

Sesuai alur WMS `/api/movement/in`, bot mencatat:

- `Barang Masuk` pada `SHEET_ID_2026`: tanggal M/D/YYYY, asal, tujuan, SKU, nama, qty,
  status `Movement`, PIC, keterangan `INTERNAL STOCK TRANSFER | WA:<referensi>`.
- `Movement` pada `SHEET_ID_INVENTORY`: tanggal YYYY-MM-DD, asal, tujuan, SKU, nama,
  stok lokasi awal, dan stok aktual (jumlah yang dipindahkan).

Bot tidak membuat Barang Keluar tambahan karena alur movement WMS saat ini menggunakan
Barang Masuk berstatus Movement. Formula Kartu Stok tetap mengikuti WMS; jalankan sinkronisasi
WMS agar pencarian Supabase mencerminkan transaksi baru. Bot membaca ulang Kartu Stock dari
spreadsheet sumber dan menolak stok berubah/tidak cukup, baris SKU/lokasi ganda, lokasi asal
sama dengan tujuan, atau susunan header yang tidak sesuai sebelum menulis.

Konfirmasi memakai klaim bersyarat session (nonce + tahap confirm + belum kedaluwarsa), sehingga
konfirmasi ganda untuk draft yang sama tidak menulis ulang. Dua spreadsheet tidak dapat ditulis
secara atomik: bila Barang Masuk tersimpan tetapi riwayat Movement gagal, bot menyebutkan kondisi
tersebut dan referensi untuk pemeriksaan admin. Jangan mengulang transaksi yang belum terkonfirmasi.
Pemeriksaan stok lalu penulisan Google Sheets bukan lock stok lintas pengguna maupun aplikasi WMS;
hindari menjalankan perpindahan bersamaan untuk SKU/lokasi yang sama. Setelah menyimpan, periksa
sinkronisasi sebelum membuat perpindahan berikutnya pada stok yang sama.

## Inbound/outbount dengan profil nomor WhatsApp

Menu `6` (Inbound) dan `7` (Outbount). Kirim `inbound`, `outbount`, atau pencarian langsung
`inbound merlyn`. Alias `outbound`, `stock in/out`, `stok in/out`, dan `stock-in/out` tetap berlaku.
Inbound: cari SKU/nama → pilih barang → isi **From** → isi **To** → qty → konfirmasi `simpan`.
Outbount: cari SKU/nama → pilih barang → lokasi From → qty → konfirmasi `simpan`.
Balas `sama` pada To/lokasi untuk memakai lokasi hasil. `ubah` memulai ulang; `batal`/`menu`
membatalkan. Navigasi pencarian `lanjut`/`sebelumnya`, 10 hasil per halaman. Inbound boleh memilih
barang stok 0 dan tujuan baru; outbount hanya memilih stok positif dan memeriksa stok lokasi asal.
Barang harus tersedia dalam katalog Kartu Stok; pembuatan SKU baru belum didukung.

Akses melalui `public.users.phone_number` dengan role PIC atau Developer. Isi nomor teks
`628xxxxxxxxxx` tanpa pemisah, unik per profil. Bentuk tersimpan `08xxxxxxxxxx` dan `+628xxxxxxxxxx`
juga diterima. Dua profil dengan nomor sama ditolak. Profil/role diperiksa ulang sebelum simpan;
nomor terdaftar dapat mencari tanpa allowlist statis. `WHATSAPP_EDITOR_NUMBERS` tidak diperlukan
untuk inbound/outbount. User lama di allowlist tanpa profil tetap hanya dapat mencari.

**PIC mengikuti konfigurasi WMS, bukan nama user.** Aplikasi dan bot memakai mapping bersama
`assets/js/pic-config.js` (`APP_CONFIG.PIC_BY_ROLE`): Inventory/Developer → ABI, Inbound → ENGGAL,
Outbound → EPRIL, Picker → WINDI. Role tak terpetakan mengikuti fallback Inventory seperti aplikasi.
Jika role berubah dan menghasilkan PIC berbeda setelah preview, bot meminta konfirmasi ulang.
Perubahan mapping bersama juga memicu deploy bot melalui GitHub Actions.

Tanggal otomatis zona bisnis Asia/Jakarta (atau `BUSINESS_TIME_ZONE`), format Sheets M/D/YYYY.
Inbound menulis From dan To yang diisi user, status `Barang Masuk`, PIC konfigurasi, dan Keterangan
persis **`RECEIPT`**. Outbount memakai From lokasi stok, status `Barang Keluar`, PIC konfigurasi,
dan Keterangan `STOCK OUT WHATSAPP`. Kolom bisnis tambahan tidak dikarang dari profil.

Penulisan memilih baris kosong paling awal mulai baris 2 dengan A:I kosong. Baris sebagian terisi
atau memiliki data literal pada kolom bisnis J:O/P dilewati; formula di luar A:I tetap dipertahankan.
Bot memeriksa ulang A:I baris terpilih sebelum PUT RAW pada range baris tersebut, tanpa append
atau menyisipkan baris baru. RAW menjaga SKU nol di depan dan mencegah teks dianggap formula.
Jika baris terlanjur diisi proses lain, transaksi ditolak. Pemeriksaan dan PUT bukan transaksi atomik
Google Sheets lintas aplikasi, sehingga proses lain masih bisa menulis setelah pemeriksaan terakhir.
Konfirmasi nonce session tetap mencegah pengulangan draft yang sama. Sinkronkan WMS setelah simpan.

Setelah penulisan berhasil, bot mencatat activity_logs WMS dengan ID/email profil pengirim,
role, referensi draft, nomor baris sheet, SKU, qty, From, To, PIC dan Keterangan. Nama profil hanya
untuk identitas audit/welcome, bukan kolom PIC. Jika audit gagal, bot menyebut transaksi sudah
tersimpan dan jangan diulang. Referensi UUID tidak lagi dicampurkan ke kolom Keterangan inbound.

History Google Sheets adalah catatan terpisah yang dikendalikan Google. Bot tidak dapat mengisi
nama editor/history Google dengan nama profil WMS. OAuth menentukan akun yang dipakai untuk API;
penampilan identitas editor pada version/edit history tetap mengikuti perilaku Google Sheets.
Gunakan `cek google` untuk memeriksa email akun OAuth jika scope userinfo.email telah diberikan.
Kolom nomor telepon dibuat admin; deploy ini tidak mengubah isi/struktur tabel users atau memperbaiki
baris transaksi lama secara otomatis. Tes tidak membuat transaksi produksi.

## Sapaan welcome

Saat membuka menu utama (`menu`, `help`, `bantuan`, `mulai`, `start`, `halo`, `hai`,
atau salam `selamat pagi/siang/sore/malam`), bot menampilkan welcome sebelum daftar menu.
Nama diambil dari `users.full_name` (fallback `username`) dan role dari `users.role`,
berdasarkan nomor WhatsApp pengirim. Nomor lama di allowlist yang belum memiliki profil
mendapat welcome umum dengan keterangan bahwa nama dan role belum tersedia.

Sapaan memakai waktu `BUSINESS_TIME_ZONE`, default `Asia/Jakarta`:
pagi 05:00–10:59, siang 11:00–14:59, sore 15:00–17:59, dan malam 18:00–04:59.
Isi salam yang dikirim tidak mengubah sapaan waktu sebenarnya. Sapaan tidak ditambahkan
ke hasil pencarian, panduan submenu, atau langkah transaksi yang sedang aktif.

Tampilan hasil Barang Masuk/Keluar memakai label `SKU`, `Tanggal`, `From`, `To`,
`Qty`, `Status`, dan `PIC`. Kolom Keterangan tidak ditampilkan dalam hasil pencarian;
data aslinya tetap tersimpan dan dapat digunakan untuk pencarian atau edit.

## Menggunakan akun Gmail melalui OAuth

Bot mendukung OAuth akun Google pribadi untuk semua operasi Google Sheets (edit, movement,
inbound, dan outbount). Email Gmail dan password saja bukan kredensial API. Pemilik akun harus
mengotorisasi scope `https://www.googleapis.com/auth/spreadsheets` (dan opsional
`https://www.googleapis.com/auth/userinfo.email` untuk memverifikasi akun), lalu menyimpan refresh token
untuk bot. Akun Gmail tersebut harus memiliki akses Editor ke spreadsheet tujuan.

Langkah konfigurasi:

1. Buka Google Cloud Console pada project milik Anda, aktifkan Google Sheets API.
2. Atur Google Auth Platform / OAuth consent screen. Untuk Gmail pribadi pilih audience External;
   jika aplikasi masih Testing, tambahkan Gmail Anda sebagai test user.
3. Buat OAuth Client ID bertipe Web application. Tambahkan authorized redirect URI:
   `https://developers.google.com/oauthplayground`.
4. Buka https://developers.google.com/oauthplayground → Settings (ikon roda gigi) → aktifkan
   **Use your own OAuth credentials**, isi Client ID dan Client Secret dari langkah sebelumnya.
   Pilih Access type **Offline** dan consent prompt jika tersedia.
5. Masukkan scope `https://www.googleapis.com/auth/spreadsheets`, klik Authorize APIs,
   login menggunakan Gmail yang mempunyai akses spreadsheet, lalu setujui izin Google.
6. Klik Exchange authorization code for tokens. Ambil **refresh token**, bukan access token.
7. Isi Supabase Dashboard → Edge Functions → Secrets:
   - `GOOGLE_OAUTH_CLIENT_ID`: Client ID OAuth milik project Anda.
   - `GOOGLE_OAUTH_CLIENT_SECRET`: Client Secret OAuth tersebut.
   - `GOOGLE_OAUTH_REFRESH_TOKEN`: refresh token akun Gmail yang sudah memberi izin.
   - `SHEET_ID_2026` dan `SHEET_ID_INVENTORY`: spreadsheet tujuan yang sama seperti sebelumnya.

Jika salah satu secret OAuth diisi, bot memilih mode OAuth dan mewajibkan ketiganya lengkap.
OAuth yang gagal/tidak lengkap tidak otomatis memakai Service Account lama. Jika ketiga secret
OAuth tidak tersedia, konfigurasi Service Account tetap berlaku. Secret lama boleh dihapus setelah
OAuth akun Gmail berfungsi. Dukungan ini hanya mengubah bot Edge Function; aplikasi Cloudflare WMS
masih menggunakan konfigurasi Service Account-nya sendiri.

Untuk scope Sheets, refresh token dari consent screen External berstatus **Testing** biasanya
kedaluwarsa setelah 7 hari. Untuk pemakaian bot berkelanjutan, atur status publishing yang sesuai
(Production) dan ikuti persyaratan verifikasi yang ditampilkan Google. Token juga bisa dicabut
melalui pengaturan akun Google; bot akan gagal autentikasi sampai akses diotorisasi kembali.
Jangan menaruh Client Secret atau refresh token di source, chat, atau log. Simpan langsung di
Supabase Secrets. Pergantian akun efektif setelah secret OAuth lengkap tersedia; deploy kode
saja tidak memberikan izin akun Gmail dan tidak memindahkan kredensial secara otomatis.

## Diagnostik Google

Kirim `cek google` (menu 8) untuk memeriksa kredensial aktif, autentikasi, akses baca spreadsheet,
dan keberadaan tab wajib tanpa menulis transaksi atau mengubah draft aktif. Pemeriksaan baca
tidak membuktikan izin Editor atau izin menulis pada tab yang dilindungi.

Error inbound/outbount kini membedakan kegagalan sebelum penulisan (tidak ada transaksi ditulis)
dengan penulisan yang sudah dicoba tetapi belum terkonfirmasi. Kode error membedakan refresh token
ditolak, OAuth Client ID/Secret salah, Sheets API belum aktif, scope kurang, spreadsheet/tab
tidak ditemukan, akses ditolak, dan batas request Google. Log hanya menyimpan referensi draft,
kode error, dan apakah penulisan sudah dicoba; token dan respons mentah Google tidak dicetak.
Untuk error lama yang belum terkonfirmasi, periksa keterangan `WA:<referensi>` pada Barang Masuk/Keluar
sebelum mengulang transaksi.

Untuk memverifikasi Gmail OAuth melalui `cek google`, authorize ulang di OAuth Playground
menggunakan kedua scope berikut (pisahkan dengan spasi):

```text
https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email
```

Gunakan OAuth client yang sama dan simpan refresh token hasilnya di Supabase Secrets. Scope email
hanya untuk membaca identitas akun; tanpa scope ini transaksi tetap dapat berjalan tetapi bot
tidak dapat memastikan email Google yang terotorisasi. Pemeriksaan tidak mengubah version history.

## Spreadsheet transaksi dan sumber Kartu Stock terpisah

`SHEET_ID_2026` adalah tujuan **Barang Masuk** dan **Barang KeIuar**; tab Kartu Stock tidak
wajib berada di spreadsheet transaksi. `SHEET_ID_INVENTORY` digunakan untuk riwayat Movement
serta pencarian sumber Kartu Stock Google. Jika tab Kartu Stock tidak ditemukan di Inventory,
bot mencoba spreadsheet transaksi untuk kompatibilitas konfigurasi lama. Error izin/auth
bukan alasan untuk berpindah sumber secara otomatis.

Opsional **`SHEET_ID_KARTU_STOK`**: ID spreadsheet sumber Kartu Stock yang sama dengan sumber
sinkronisasi WMS. Jika diisi, hanya sumber tersebut yang dipakai dan tidak ada fallback.
Gunakan ini jika Kartu Stock berada di spreadsheet ketiga, atau untuk memastikan sumber stok
secara eksplisit ketika lebih dari satu spreadsheet mempunyai tab Kartu Stock.
`cek google` melaporkan spreadsheet yang dipilih untuk sumber Kartu Stock, terpisah dari
pemeriksaan tab transaksi dan Movement. Pemeriksaan/penulisan inbound, outbount dan movement
menggunakan pemilihan sumber yang sama. Pencarian chat tetap membaca mirror Supabase.

Pembacaan header Kartu Stock memeriksa 50 baris pertama dan kolom A:AZ, sehingga judul
di atas tabel tidak mengganggu. Alias Lokasi/Location, Nama Barang/Description,
dan Stok Akhir/Saldo Akhir/Ending Stock didukung. Stok Akhir diprioritaskan
di atas Qty; Stok Awal tidak digunakan sebagai saldo tersedia. Header ganda ditolak.
`cek google` juga melaporkan baris header dan nama kolom yang terbaca, tanpa menulis transaksi.

Jika pembacaan seluruh kolom ditolak Google karena ukuran respons atau batas grid,
bot membaca ulang dengan batas kolom aktual dan per 1.000 baris sampai akhir grid.
Baris kosong tetap dipertahankan agar pemilihan baris transaksi tidak bergeser.
Kegagalan salah satu batch membatalkan proses sebelum menulis; data parsial tidak digunakan.
Error pembacaan mencantumkan tahap/tab dan nama konfigurasi spreadsheet tanpa respons mentah Google.
