-- Authoritative SKU-level warning. Movement is part of the Barang Masuk ledger
-- and therefore counts as inbound evidence, matching the existing page scope.
create or replace function public.inventory_outbound_without_inbound()
returns table (sku text, nama_barang text)
language sql
stable
security definer
set search_path = public
as $$
  with outbound as (
    select
      upper(btrim(bk.sku::text)) as normalized_sku,
      min(btrim(coalesce(bk.sku::text, ''))) as sku,
      min(nullif(btrim(coalesce(bk.nama_barang::text, '')), '')) as nama_barang
    from public.inventory_barang_keluar bk
    where btrim(coalesce(bk.sku::text, '')) <> ''
    group by upper(btrim(bk.sku::text))
  )
  select o.sku, coalesce(o.nama_barang, '-')
  from outbound o
  where not exists (
    select 1
    from public.inventory_barang_masuk bm
    where upper(btrim(coalesce(bm.sku::text, ''))) = o.normalized_sku
      and upper(btrim(coalesce(bm.status::text, ''))) in ('BARANG MASUK', 'MOVEMENT')
  )
  order by o.normalized_sku;
$$;

revoke all on function public.inventory_outbound_without_inbound() from public;
grant execute on function public.inventory_outbound_without_inbound() to service_role;
