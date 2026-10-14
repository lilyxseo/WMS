# Warning detection

The page describes data findings, not proof of physical loss. It separates row-level evidence from review items and displays source/field coverage. Failed reads, missing sync metadata, active locks and changed source versions suppress the affected source. Cross-source rules require all relevant sources to be stable.

## Production data audit, 13 October 2026

Read-only Supabase audit found 7,441 Kartu Stok rows, 1,342 RPL rows and 3,000 BULKY rows. Kartu Stok had 25 negative closing balances and 3,155 zero-stock rows. All 7,440 rows with complete components satisfied:

`STOK AKHIR = STOK AWAL - INTERNAL STOCK TRANSFER - REPLENISHMENT - PENGELUARAN`

All 4,342 RPL/BULKY rows had no Netsuite or difference reference. There were no active-name conflicts or positive-stock rows missing SKU/name/location. The old SKU-presence RPC returned one outbound-only SKU; its outbound record was positive PENGELUARAN and had no stock evidence. Counts describe this audit snapshot, not permanent expected totals.

## Enabled checks

- Negative closing balance on a Kartu Stok row, with source row/location evidence.
- Incorrect same-row Kartu Stok arithmetic only when all five numeric components are valid. Missing/ambiguous numbers are not coerced to zero; tiny floating-point differences are tolerated.
- Missing SKU on a meaningful stock row; blank templates and header rows are ignored.
- Missing name for a nonzero-stock SKU; missing location only for positive stock.
- Material name differences among positive-stock rows. Case, whitespace and punctuation are ignored; historical zero-stock names are excluded. This is a review item, not an automatic rename instruction.
- Accuracy difference only when every participating SKU row has coherent stock, Netsuite and difference values. Offsetting differences remain zero. Unavailable reference data is reported as skipped coverage.
- Positive outbound PENGELUARAN with no SKU in inbound or any of the three stock sources. Inbound rows of any status and zero-stock opening-balance records count as evidence. This is Medium/review: missing history does not establish that goods were never received.

## Deliberately excluded inferences

Never compare raw outbound totals with one stock location, infer duplicate transactions from repeated SKU/reference/quantity, require optional Netsuite values, or reject operational location names using a fixed rack whitelist. Periods, split shipments, opening balances and evolving warehouse areas can make those assumptions wrong. No transaction table is downloaded into the Worker; the cross-ledger review runs as a server-only database RPC.

The read-only audit workflow and main deployment validation report detector counts/coverage. They do not modify stock, ledgers or notes. Tests cover known production arithmetic, legitimate operational locations, historic name changes, missing references, partial/changed reads and real contradictory data.

### Notifikasi WhatsApp otomatis

Edge Function `warning-whatsapp` memeriksa sumber lengkap setiap 5 menit melalui job `wms-warning-notifications`. Nomor tujuan berasal dari secret `WMS_WARNING_RECIPIENTS`. Fungsi bot dan jadwal ringkasan harian tidak diubah.

Saat pertama diaktifkan, semua warning saat ini dicatat sebagai baseline tanpa pesan. Hanya identitas warning yang belum pernah tercatat yang masuk antrean. Identitas memakai kategori, SKU, sumber/baris; perubahan qty atau teks bukti tidak mengirim ulang. Warning yang pernah tercatat, termasuk yang muncul kembali, tidak dikirim ulang. Snapshot parsial tidak mengubah registri maupun mengirim pesan. Maksimal 5 warning per pesan dan 4 pesan per pemeriksaan; sisanya diproses pada pemeriksaan berikutnya.

Antrean dicatat sebelum meminta Fonnte. Status `sent` berarti diterima Fonnte, bukan jaminan sudah dibaca. Penolakan dicatat `failed`; timeout/hasil tidak pasti atau pekerja terhenti dicatat `uncertain`, tanpa pengiriman ulang otomatis untuk mencegah pesan ganda. Administrator dapat memeriksa tabel privat `warning_notify_outbox`. Endpoint memerlukan secret tersendiri dan tidak dapat dipanggil pengguna anonim. Deployment menguji koneksi dan baseline tanpa mengirim pesan percobaan.

## Dampak movement (14 Oktober 2026)

Audit kasus SKU `682200007014` mengonfirmasi transaksi 10 pcs C18-1 → C01-1, Barang Masuk baris 23547 tanggal 9 Oktober. Snapshot Kartu Stok masih menunjukkan saldo 10/0 dan INTERNAL STOCK TRANSFER 0 di kedua lokasi. Pemeriksaan rumus saldo biasa tidak menangkapnya karena aritmetika tetap cocok sementara komponen mutasinya tidak terisi.

Kategori `Movement Belum Berdampak` meninjau komponen pengurangan From (INTERNAL STOCK TRANSFER atau REPLENISHMENT) yang tetap 0 meskipun ada movement dengan netto lokasi tidak 0. Penerimaan To diperiksa melalui STOK AWAL/saldo; kolom transfer tujuan 0 merupakan pola WMS yang sah jika penerimaan sudah tercermin. Pasangan SKU/lokasi yang belum memiliki baris di ketiga sumber stok juga ditinjau jika lokasi pasangannya masih memiliki stok positif. Warning menampilkan From → To, qty agregat rute, transaksi terbaru pada rute, dan baris stok/bukti komponen yang tidak tercermin. Ini temuan untuk verifikasi formula/rentang/periode, bukan perintah otomatis mengoreksi saldo. Qty 0 dan From = To memiliki kategori `Movement Tanpa Perubahan` tersendiri.

Pengaman: kelima sumber harus stabil; snapshot ketiga sumber stok harus lebih baru sekurangnya 2 menit dari movement terakhir yang tercermin di database. Netto transfer balik yang menjadi 0, transaksi lanjutan pada hari yang sama/setelahnya, tanggal/angka tidak valid, periode lama, kolom belum terbaca, dan saldo akhir 0 semata tidak disimpulkan sebagai movement gagal. Komponen yang sudah nonzero tidak dibandingkan dengan total mentah untuk menuduh selisih qty. Deteksi terbatas pada movement dengan jenis mutasi yang diketahui; operasi lain dan input yang belum pernah tercatat membutuhkan bukti berbeda.

RPC privat mengirim konteks movement minimal dan ringkasan aktivitas lokasi, bukan seluruh ledger atau kolom dokumen/profile. JSON tunggal mencegah batas baris PostgREST memotong movement. Kategori baru tersedia otomatis pada filter halaman Warning dan menggunakan antrean WhatsApp yang sama.
