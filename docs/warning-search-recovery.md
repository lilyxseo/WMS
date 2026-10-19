# Warning dan pencarian transaksi

Audit produksi menemukan kelima sumber gagal sinkron karena autentikasi Gmail di Supabase gagal. Status error membuat pembacaan lama mengabaikan seluruh stok meskipun snapshot terakhir masih tersedia. Metadata sinkron kini dibaca dengan `select=*` untuk kompatibilitas antarversi.

Warning boleh membaca snapshot terakhir hanya jika fingerprint SHA-256 data database sama dengan versi sinkronisasi sukses terakhir, sebelum dan setelah pembacaan. RPC privat menghitung fingerprint dalam urutan yang sama dengan sync engine. Versi berubah, lock aktif, checksum berbeda/hilang, atau bukti tidak tersedia tetap menonaktifkan sumber tersebut. Snapshot lama ditandai di halaman dan hasilnya `partial`; notifikasi WhatsApp tidak dikirim dari snapshot tersebut. Ini tidak mengubah atau menyamarkan status sinkronisasi error.

Pencarian Barang Masuk/Keluar memakai RPC privat yang menyaring seluruh kolom bisnis di PostgreSQL dengan indeks trigram. Kata digabung dengan AND; angka qty, nomor transfer, teks dokumen dan wildcard literal tetap didukung. Aplikasi hanya mengambil baris yang cocok, lalu mempertahankan normalisasi tanggal campuran dan urutan natural sebelum pagination. Tidak ada batas 5.000 baris. Jika RPC belum terpasang saat rollout, pembacaan lama hanya digunakan untuk kode fungsi belum tersedia; timeout/izin ditolak tidak memicu scan kedua. Offset mengikuti jumlah baris nyata saat REST membatasi ukuran batch.

Frontend mengirim `includeSummary=0` saat ringkasan sudah di-cache. API juga mengenali nilai `false` dari bundle lama agar request metadata tidak diulang.

Migration dan indeks dipasang oleh workflow aplikasi sebelum validasi Warning. Bridge Gmail dideploy sebelum validasi itu agar perbaikan autentikasi tidak terblokir oleh sumber yang sedang gagal. Error OAuth hanya mengembalikan kode allowlist; token dan respons privat Google tidak diteruskan. Jika token ditolak, kredensial Gmail tetap perlu diperbarui melalui konfigurasi Supabase.

Pengujian meliputi regresi Node serta PostgreSQL lokal (PGlite): migration idempoten, pencarian kedua ledger, indeks trigram, wildcard/injection, hak RPC, dan kesamaan checksum terhadap sync engine. Tidak ada transaksi inventory yang ditulis dalam pengujian.
