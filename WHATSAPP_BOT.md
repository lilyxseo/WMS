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
Nomor 1–7 membuka panduan, bukan memilih hasil saat wizard tidak aktif.
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

## Stock in/out dengan profil nomor WhatsApp

Menu `6` dan `7` menampilkan panduan. Kirim `stock in`, `stock out`, atau langsung
`stock out merlyn a20-1`. Alias `stok in`, `stok out`, `stock-in`, dan `stock-out` juga diterima.
Alur: cari SKU/nama → pilih nomor barang → isi lokasi → qty → `simpan`.
Balas `sama` pada tahap lokasi untuk memakai lokasi hasil pencarian. Tidak ada pertanyaan
PIC, tanggal, status, atau keterangan. `ubah` memulai ulang draft; `batal` dan `menu` membatalkan.
Pencarian dipaginasi 10 hasil; gunakan `lanjut` / `sebelumnya`.
Stock in menampilkan juga barang stok 0 dan boleh menggunakan lokasi tujuan baru.
Stock out hanya menampilkan stok positif, lalu memeriksa stok SKU pada lokasi asal yang dipilih.
Saat ini pemilihan barang menggunakan katalog Kartu Stok; pembuatan SKU baru belum didukung.

Profil dibaca dari `public.users` berdasarkan `phone_number`, mengambil `id`, `full_name`,
`username`, `email`, dan `role`. Isi nomor dalam format teks `628xxxxxxxxxx` tanpa pemisah,
satu nomor untuk satu profil. Lookup juga menerima nilai tersimpan `08xxxxxxxxxx` dan `+628xxxxxxxxxx`.
Normalisasi nomor pengirim mendukung tanda `+`, spasi, dan tanda hubung. Nilai nomor di kolom
profil sebaiknya tetap disimpan tanpa pemisah. Jika lookup menemukan dua profil, transaksi ditolak.
Nama lengkap wajib; PIC transaksi menggunakan `full_name`, bukan input chat.

Role PIC (sesuai pemeriksaan role aplikasi) atau `Developer` dapat membuat stock in/out.
Role lain hanya boleh membaca. Nomor tidak perlu ditambahkan ke `WHATSAPP_EDITOR_NUMBERS`
untuk stock in/out. Profil dibaca kembali pada setiap langkah; perubahan user ID, nomor,
atau pencabutan izin sebelum konfirmasi mencegah penyimpanan. Jika nama PIC berubah setelah
preview, bot menampilkan preview baru dan meminta `simpan` lagi. User terdaftar juga dapat
mengakses pencarian tanpa allowlist statis. Nomor lama di allowlist masih dapat mencari,
tetapi tidak dapat membuat stock in/out tanpa profil yang cocok dan memiliki izin.

Data otomatis: tanggal M/D/YYYY mengikuti zona bisnis Asia/Jakarta (atau `BUSINESS_TIME_ZONE`),
status `Barang Masuk` / `Barang Keluar`, PIC dari profil, serta keterangan berisi jenis transaksi,
referensi UUID draft, dan ID user. Stock in menulis lokasi ke kolom `TO` pada `Barang Masuk`;
stock out menulis lokasi ke `FROM` pada `Barang KeIuar`. Lokasi pihak luar pada kolom pasangannya
dibiarkan kosong karena tidak diminta user dan tidak tersedia di struktur profil saat ini.
Kolom bisnis lainnya mengikuti nilai kosong/default spreadsheet, tidak dikarang dari profil.

Google Sheets tetap menjadi sumber transaksi. Bot memakai `RAW` agar SKU dengan nol di depan
terjaga dan teks tidak dijalankan sebagai formula. Sebelum penulisan, bot memeriksa ulang SKU/nama
pada Kartu Stock sumber, stok asal untuk stock out, dan header sheet tujuan. Stock out ditolak
jika stok berubah, kurang, atau SKU/lokasi memiliki baris ganda. Konfirmasi memakai nonce dan klaim
session bersyarat untuk mencegah penulisan ulang draft yang sama. Pemeriksaan stok dan penulisan
Google Sheets belum merupakan transaksi atomik lintas aplikasi; hindari pengeluaran bersamaan
untuk SKU/lokasi yang sama. Jalankan sinkronisasi WMS agar data pencarian Supabase diperbarui.
Untuk kegagalan yang belum terkonfirmasi, bot memberikan referensi dan tidak mencoba menulis ulang.

Kolom nomor telepon ditambahkan oleh admin di luar deploy ini. Deploy tidak mengubah struktur
atau isi tabel `users`, dan tes menggunakan profil serta Sheets tiruan tanpa transaksi produksi.

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
