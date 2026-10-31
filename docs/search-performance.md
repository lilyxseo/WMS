# Audit pencarian lintas halaman

Pencarian data gudang tidak menunggu pembacaan Google Sheets pada setiap ketikan. Spreadsheet masuk lewat pipeline sinkronisasi; hasil pencarian mencerminkan snapshot database terakhir yang berhasil disinkronkan, bukan jaminan perubahan sheet langsung terlihat tanpa waktu sinkronisasi.

| Bagian | Jalur dan perbaikan |
| --- | --- |
| Cari SKU | Satu RPC `wms_inventory_search` menggantikan lima round trip. Semua kata dicocokkan (mengandung, tidak harus berurutan), SKU persis diprioritaskan, lalu maksimum 100 SKU. Agregasi stok/lokasi dilakukan untuk seluruh baris SKU terpilih, bukan 50 baris per sumber. |
| Form Input dan Reject | Tetap memakai endpoint/otorisasi masing-masing. Lookup berulang memakai cache sesi pendek; indeks trigram pada tabel inventory mempercepat pencarian mengandung. Tidak mengubah validasi nama/qty saat simpan. |
| Movement / Cycle Count | Tetap memakai data kartu stok/lookup yang ada, tidak mengubah draft atau cara penyimpanan. Indeks dan cache pada lookup kartu stok membantu jalur bersama. |
| Barang Masuk/Keluar | Pencarian server dan filter global tetap sebelum pagination; lookup berulang dapat memakai cache pendek. Pemrosesan batch membatasi memori Worker. |
| Lokasi, Aging, Akurasi, Warning | Endpoint/database/snapshot masing-masing dipertahankan; request pencarian GET yang masuk daftar cache tidak perlu dikirim ulang untuk query identik yang baru selesai. |
| Katalog | Query/filter server sebelum pagination, cache sumber katalog 60 detik yang sudah ada dipertahankan. `refresh=1` selalu melewati cache pencarian browser. |
| Balikan Store | Semua TRIP tetap dibaca melalui batch API yang ada saat cache sheet belum tersedia. Pencarian selanjutnya memakai baris seluruh TRIP yang berhasil dimuat, bukan membuat satu permintaan untuk setiap ketikan. Tidak menganggap sheet yang gagal sebagai data lengkap. |
| Arsip / Asset Store | Isi sheet dimuat melalui backend berautentikasi dan cache halaman yang ada; pencarian pada isi yang sudah dimuat tidak mengulangi pembacaan sheet setiap ketikan. |
| File Manager / Catatan / Log Aktivitas | Tetap menggunakan endpoint pribadi/pagination masing-masing; tidak dimasukkan ke cache inventory lintas sesi. |

Debounce Cari SKU menjadi 250 ms tanpa tambahan antrean `requestIdleCallback`. Pembatalan request dan pemeriksaan token pencarian tetap mencegah hasil lama menimpa query baru.

Cache response pencarian berada dalam memori browser, maksimal 16 response × 128 KB, usia maksimum 5 detik, dipisahkan menurut generasi sesi dan URL lengkap. Tidak menyimpan error, query berbeda, file, atau response autentikasi. Cache dibersihkan saat request perubahan dimulai/selesai, versi inventory berubah, atau Refresh manual. Ini cache hasil sukses, bukan cache pembacaan spreadsheet. API tetap mengotorisasi setiap permintaan yang benar-benar dikirim ke server.

RPC hanya boleh dipanggil `service_role`. Migrasi dipasang oleh workflow `deploy-app-google-auth.yml` melalui `deploy-transaction-search.mjs`. Sebelum migrasi tersedia, API hanya fallback untuk kode RPC hilang (`PGRST202`, `42883`); timeout/akses ditolak tidak memicu lima query tambahan. Pengujian lokal bukan pengukuran latency produksi; aktivasi RPC/index dan dampak pada data produksi perlu diverifikasi dari workflow/log yang dapat diakses.
