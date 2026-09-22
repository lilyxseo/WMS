-- The warning is an SKU-presence check, not a quantity comparison. A SKU may
-- legitimately be stored and dispatched from several locations, so summing
-- Barang Keluar across locations and comparing it with one inbound location
-- creates a false warning.
drop function if exists public.inventory_outbound_without_inbound();

create function public.inventory_outbound_without_inbound()
returns table (sku text, nama_barang text)
language sql
stable
security definer
set search_path = public
as $$
  with outbound as (
    select
      public.inventory_normalize_sku(bk.sku::text) as normalized_sku,
      min(btrim(coalesce(bk.sku::text, ''))) as sku,
      min(nullif(btrim(coalesce(bk.nama_barang::text, '')), '')) as nama_barang
    from public.inventory_barang_keluar bk
    where public.inventory_normalize_sku(bk.sku::text) <> ''
    group by public.inventory_normalize_sku(bk.sku::text)
  )
  select
    o.sku,
    coalesce(o.nama_barang, '-')
  from outbound o
  where not exists (
    select 1
    from public.inventory_barang_masuk bm
    where public.inventory_normalize_sku(bm.sku::text) = o.normalized_sku
  )
  order by o.normalized_sku;
$$;

revoke all on function public.inventory_outbound_without_inbound() from public;
grant execute on function public.inventory_outbound_without_inbound() to service_role;
