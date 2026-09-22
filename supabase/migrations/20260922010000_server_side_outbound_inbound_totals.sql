-- Warning totals must be calculated from the complete database tables. The
-- browser only holds the currently loaded transaction page and can therefore
-- incorrectly report an existing Barang Masuk quantity as zero.
drop function if exists public.inventory_outbound_without_inbound();

create function public.inventory_outbound_without_inbound()
returns table (sku text, nama_barang text, inbound_qty numeric, outbound_qty numeric)
language sql
stable
security definer
set search_path = public
as $$
  with inbound as (
    select
      public.inventory_normalize_sku(bm.sku::text) as normalized_sku,
      sum(coalesce(bm.qty, 0)) as inbound_qty
    from public.inventory_barang_masuk bm
    where public.inventory_normalize_sku(bm.sku::text) <> ''
    group by public.inventory_normalize_sku(bm.sku::text)
  ), outbound as (
    select
      public.inventory_normalize_sku(bk.sku::text) as normalized_sku,
      min(btrim(coalesce(bk.sku::text, ''))) as sku,
      min(nullif(btrim(coalesce(bk.nama_barang::text, '')), '')) as nama_barang,
      sum(coalesce(bk.qty, 0)) as outbound_qty
    from public.inventory_barang_keluar bk
    where public.inventory_normalize_sku(bk.sku::text) <> ''
    group by public.inventory_normalize_sku(bk.sku::text)
  )
  select
    o.sku,
    coalesce(o.nama_barang, '-'),
    coalesce(i.inbound_qty, 0),
    o.outbound_qty
  from outbound o
  left join inbound i using (normalized_sku)
  where o.outbound_qty > coalesce(i.inbound_qty, 0)
  order by o.normalized_sku;
$$;

revoke all on function public.inventory_outbound_without_inbound() from public;
grant execute on function public.inventory_outbound_without_inbound() to service_role;
