# Tambah baris Balikan Store

PIC/Developer dapat membuka **Tambah Baris** pada sheet TRIP aktif, mengisi SKU/nama (lookup memakai endpoint master Form Input), Qty, kolom Balikan lainnya dan kolom dinamis sheet. Input terdiri dari baris tabel; Tab/Arrow membantu navigasi. Maksimal 50 baris per pengiriman. SKU dan Qty positif wajib; nama diambil dari master jika SKU dikenali, atau diisi manual untuk SKU di luar master. No dan Centang dibuat otomatis.

Draft disimpan per akun/sheet di browser. Tinjau & Simpan menampilkan konfirmasi tujuan sheet dan ringkasan input. Perubahan tabel yang belum diterapkan harus disimpan/dibatalkan dahulu. Sheet tidak dapat dipakai sebelum data/header dimuat.

`/api/balikan-store/rows` memakai identitas login terverifikasi, spreadsheet Inventory yang dikonfigurasi server, dan tab TRIP yang benar-benar ada. Header dibaca ulang dan nama SKU divalidasi terhadap database. Request insert/copy format/data validation/write/receipt dikirim dalam satu batch Google Sheets; data lama tidak ditimpa. Input teks disimpan sebagai literal, bukan formula. Hanya formula No yang dibuat server.

Idempotency memakai tabel `stock_entry_batches` yang sudah tersedia untuk Form Input (tidak memerlukan migrasi baru) dan receipt developer metadata di Google Sheets. Jika koneksi terputus, input dikunci dan tombol **Periksa status** memeriksa receipt; tidak mengirim ulang data. Draft pending tetap tersedia setelah refresh. Periksa status yang gagal tidak membuka kunci input yang belum terkonfirmasi.

Setelah berhasil, cache sheet aktif dimuat ulang dan pilihan baris lama dibersihkan karena penyisipan dapat menggeser nomor baris. Tidak ada penulisan inventory produksi pada pengujian otomatis.
