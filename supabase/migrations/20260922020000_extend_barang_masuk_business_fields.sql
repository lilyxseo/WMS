-- Barang Masuk sheet columns J:O. Text preserves identifiers, URLs, leading
-- zeroes, and the source's mixed STOCKOUT values without coercion.
alter table public.inventory_barang_masuk
  add column if not exists no_iseller text,
  add column if not exists netsuite text,
  add column if not exists keterangan_lainnya text,
  add column if not exists lokasi_surat_jalan text,
  add column if not exists stockout text,
  add column if not exists dokumen text;
