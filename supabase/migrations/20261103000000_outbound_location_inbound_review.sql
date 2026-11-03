-- Keep invalid-From checks and add independent SKU + location inbound evidence.
-- All inbound statuses/dates count; this is not a quantity or chronology comparison.
create or replace function public.inventory_warning_outbound_from_review()
returns table(sku text,nama_barang text,qty numeric,source_row_number integer,tanggal text,from_location text,to_location text,reason text)
language sql stable security definer set search_path=public as $$
 with locations as materialized (
  select distinct upper(regexp_replace(btrim(coalesce(lokasi_bulky::text,'')),'[[:space:]]+',' ','g')) as location from public.inventory_kartu_stok
 ), candidates as (
  select bk.*,upper(regexp_replace(btrim(coalesce(bk.from_location::text,'')),'[[:space:]]+',' ','g')) as normalized_from
  from public.inventory_barang_keluar bk where bk.qty>0 and btrim(coalesce(bk.sku::text,''))<>''
 )
 select bk.sku::text,bk.nama_barang::text,bk.qty::numeric,bk.source_row_number::integer,bk.tanggal::text,bk.from_location::text,bk.to_location::text,
  case when bk.normalized_from='' then 'empty' when bk.normalized_from ~ '[,;|/+&]' or bk.from_location::text ~ E'[\\n\\r]' then 'multiple' else 'unknown' end
 from candidates bk where bk.normalized_from='' or bk.normalized_from ~ '[,;|/+&]' or bk.from_location::text ~ E'[\\n\\r]'
 or (bk.normalized_from !~ '^[A-H](0[1-9]|1[0-9]|20)-[1-5]$' and not exists(select 1 from locations l where l.location=bk.normalized_from))
 union all
 select bk.sku::text,bk.nama_barang::text,bk.qty::numeric,bk.source_row_number::integer,bk.tanggal::text,bk.from_location::text,bk.to_location::text,'missing_inbound'
 from candidates bk
 where bk.normalized_from<>'' and not exists (
  select 1 from public.inventory_barang_masuk bm
  where public.inventory_warning_normalize_sku(bm.sku::text)=public.inventory_warning_normalize_sku(bk.sku::text)
   and upper(regexp_replace(btrim(coalesce(bm.to_location::text,'')),'[[:space:]]+',' ','g'))=bk.normalized_from
 )
 order by 4,8;
$$;
revoke all on function public.inventory_warning_outbound_from_review() from public,anon,authenticated;
grant execute on function public.inventory_warning_outbound_from_review() to service_role;
notify pgrst,'reload schema';
