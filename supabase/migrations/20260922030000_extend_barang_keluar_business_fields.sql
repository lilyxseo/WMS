-- Barang Keluar sheet columns J:P. The second STATUS is intentionally stored
-- separately so it never overwrites the transaction status in column G.
alter table public.inventory_barang_keluar
  add column if not exists no_iseller text,
  add column if not exists netsuite text,
  add column if not exists keterangan_lainnya text,
  add column if not exists status_lanjutan text,
  add column if not exists lokasi_surat_jalan text,
  add column if not exists no_iseller_awal text,
  add column if not exists dokumen text;
