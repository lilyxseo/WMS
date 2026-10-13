-- Absence of inbound history is a review item, never proof that stock was not
-- received. Positive dispatched rows only; existing stock is opening-balance
-- evidence. All statuses in inbound remain valid evidence of SKU presence.
create or replace function public.inventory_warning_ledger_review()
returns table(sku text,nama_barang text,qty numeric,source_row_number integer,tanggal text,from_location text)
language sql stable security definer set search_path=public as $$
 with candidates as (
  select public.inventory_normalize_sku(bk.sku::text) as normalized_sku,
   min(btrim(bk.sku::text)) as sku,min(nullif(btrim(bk.nama_barang::text),'')) as nama_barang,
   sum(bk.qty) as qty,max(bk.source_row_number)::integer as source_row_number
  from public.inventory_barang_keluar bk
  where public.inventory_normalize_sku(bk.sku::text)<>'' and bk.qty>0
   and upper(btrim(coalesce(bk.keterangan::text,'')))='PENGELUARAN'
  group by public.inventory_normalize_sku(bk.sku::text)
 ), missing as (
  select c.* from candidates c where not exists(select 1 from public.inventory_barang_masuk bm where public.inventory_normalize_sku(bm.sku::text)=c.normalized_sku)
   and not exists(select 1 from public.inventory_kartu_stok s where public.inventory_normalize_sku(s.sku::text)=c.normalized_sku)
   and not exists(select 1 from public.inventory_rpl s where public.inventory_normalize_sku(s.sku::text)=c.normalized_sku)
   and not exists(select 1 from public.inventory_bulky s where public.inventory_normalize_sku(s.sku::text)=c.normalized_sku)
 )
 select m.sku,coalesce(m.nama_barang,'-'),m.qty,m.source_row_number,bk.tanggal::text,bk.from_location::text
 from missing m left join public.inventory_barang_keluar bk on bk.source_row_number=m.source_row_number
 order by m.normalized_sku;
$$;
revoke all on function public.inventory_warning_ledger_review() from public;
grant execute on function public.inventory_warning_ledger_review() to service_role;
notify pgrst,'reload schema';
