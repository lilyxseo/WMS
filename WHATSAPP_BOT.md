# Bot WhatsApp WMS (Fonnte)

Webhook Supabase Edge Function: `POST /functions/v1/whatsapp-fonnte`.
Bot mencari data Supabase pada `inventory_kartu_stok`, `inventory_rpl`, dan
`inventory_bulky`, lalu mengirim balasan lewat `https://api.fonnte.com/send`.
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

## Pesan yang didukung

- `sku ABC123`: cari sebagian SKU, tanpa mengubah nol di depan.
- `detail ABC123`: cari SKU persis (tanpa membedakan kapitalisasi).
- `barang kabel` atau `nama barang kabel`: cari nama barang.
- `lokasi A-01`: cari lokasi.
- `cari kabel A-01` atau teks tanpa awalan: pencarian gabungan.
- `cari sku=ABC123; nama=kabel; lokasi=A-01; sumber=RPL; stok=ada`:
  pencarian terstruktur. Setiap filter harus terpenuhi pada baris yang sama.
- `barang kabel; halaman=2`: hasil berikutnya. Bot menyertakan perintah lengkap
  yang bisa disalin untuk melanjutkan, tanpa menyimpan sesi percakapan.
- `sumber=Kartu Stock`, `sumber=RPL`, atau `sumber=BULKY` setelah titik koma
  membatasi sumber. `stok=ada` berarti stok > 0; `stok=kosong` berarti stok = 0;
  default `stok=semua` turut menampilkan stok negatif jika ada.
- `bantuan`, `help`, `menu`: petunjuk penggunaan.

Pencarian tidak peka huruf besar/kecil. Semua kata harus cocok dalam field
pencarian yang dipilih. Balasan memuat SKU, nama, lokasi, stok akhir, dan sumber,
maksimal 3 baris per sumber per halaman (9 baris bila semua sumber dipilih).
Halaman 1–100 tersedia; perjelas pencarian untuk hasil yang lebih banyak.
Stok per sumber ditampilkan terpisah dan tidak dijumlahkan
lintas sumber. Hasil mencerminkan snapshot sinkronisasi WMS, bukan pembacaan
langsung Google Sheets. Balasan menunjukkan waktu sinkronisasi tertua di antara
baris hasil dalam WIB, atau menyebutkan waktu tidak tersedia. Waktu tersebut
bukan jaminan bahwa seluruh sumber baru disinkron. Navigasi menjalankan query
baru; hasil dapat bergeser jika database berubah di antara dua pesan.
Perintah `lanjut`/pemilihan nomor tanpa konteks belum didukung.

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
Deploy ke Supabase dan pengaturan webhook Fonnte belum dilakukan otomatis.
