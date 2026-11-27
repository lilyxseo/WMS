-- Flag outbound SKU/location pairs absent from both inbound history and stock records.
-- Zero stock still proves the location previously appeared for the SKU.
create or replace function public.inventory_warning_outbound_from_review()
returns table(sku text,nama_barang text,qty numeric,source_row_number integer,tanggal text,from_location text,to_location text,reason text)
language sql stable security definer set search_path=public as $$
 with locations as materialized (
  select distinct upper(regexp_replace(btrim(coalesce(lokasi_bulky::text,'')),'[[:space:]]+',' ','g')) as location from public.inventory_kartu_stok
 ), candidates as (
  select bk.*,upper(regexp_replace(btrim(coalesce(bk.from_location::text,'')),'[[:space:]]+',' ','g')) as normalized_from
  from public.inventory_barang_keluar bk where bk.qty>0 and btrim(coalesce(bk.sku::text,''))<>''
 ), inbound_missing as materialized (
  select bk.* from candidates bk
  where bk.normalized_from<>'' and not exists (
   select 1 from public.inventory_barang_masuk bm
   where public.inventory_warning_normalize_sku(bm.sku::text)=public.inventory_warning_normalize_sku(bk.sku::text)
    and upper(regexp_replace(btrim(coalesce(bm.to_location::text,'')),'[[:space:]]+',' ','g'))=bk.normalized_from
  )
 ), stock_pairs as materialized (
  select distinct public.inventory_warning_normalize_sku(sku::text) as sku,
    upper(regexp_replace(btrim(coalesce(lokasi_bulky::text,'')),'[[:space:]]+',' ','g')) as location
  from (
   select sku, lokasi_bulky from public.inventory_kartu_stok
   union all select sku, lokasi_bulky from public.inventory_rpl
   union all select sku, lokasi_bulky from public.inventory_bulky
  ) stock
 )

 select bk.sku::text,bk.nama_barang::text,bk.qty::numeric,bk.source_row_number::integer,bk.tanggal::text,bk.from_location::text,bk.to_location::text,
  case when bk.normalized_from='' then 'empty' when bk.normalized_from ~ '[,;|/+&]' or bk.from_location::text ~ E'[\\n\\r]' then 'multiple' else 'unknown' end
 from candidates bk where bk.normalized_from='' or bk.normalized_from ~ '[,;|/+&]' or bk.from_location::text ~ E'[\\n\\r]'
 or (bk.normalized_from !~ '^[A-H](0[1-9]|1[0-9]|20)-[1-5]$' and not exists(select 1 from locations l where l.location=bk.normalized_from))
 union all
 select bk.sku::text,bk.nama_barang::text,bk.qty::numeric,bk.source_row_number::integer,bk.tanggal::text,bk.from_location::text,bk.to_location::text,'missing_inbound'
 from inbound_missing bk
 union all
 select bk.sku::text,bk.nama_barang::text,bk.qty::numeric,bk.source_row_number::integer,bk.tanggal::text,bk.from_location::text,bk.to_location::text,'missing_stock_location'
 from inbound_missing bk
 where bk.normalized_from !~ '[,;|/+&]' and bk.from_location::text !~ E'[\\n\\r]'
 and not exists (
  select 1 from stock_pairs item
  where item.sku=public.inventory_warning_normalize_sku(bk.sku::text) and item.location=bk.normalized_from
 )
 order by 4,8;
$$;
revoke all on function public.inventory_warning_outbound_from_review() from public,anon,authenticated;
grant execute on function public.inventory_warning_outbound_from_review() to service_role;
notify pgrst,'reload schema';
