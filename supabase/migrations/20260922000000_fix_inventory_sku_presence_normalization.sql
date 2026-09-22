-- One string-only normalization rule for inventory SKU existence checks.
-- Spreadsheet imports can contain NBSP and zero-width Unicode characters that
-- PostgreSQL btrim() does not remove. Never cast an SKU to a numeric type.
create or replace function public.inventory_normalize_sku(value text)
returns text
language sql
immutable
parallel safe
as $$
  select upper(btrim(
    replace(replace(replace(replace(replace(replace(coalesce(value, ''),
      chr(160), ''), chr(8203), ''), chr(8204), ''), chr(8205), ''),
      chr(8288), ''), chr(65279), '')
  ));
$$;

create or replace function public.inventory_outbound_without_inbound()
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
  select o.sku, coalesce(o.nama_barang, '-')
  from outbound o
  where not exists (
    select 1
    from public.inventory_barang_masuk bm
    where public.inventory_normalize_sku(bm.sku::text) = o.normalized_sku
  )
  order by o.normalized_sku;
$$;

-- Targeted, service-role-only production diagnostic. It returns no quantities,
-- dates, locations, names, secrets, or unrelated transaction rows.
create or replace function public.inventory_sku_presence_debug(p_sku text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with requested as (
    select public.inventory_normalize_sku(p_sku) normalized_sku
  ), inbound as (
    select bm.sku::text raw_sku, bm.status::text status
    from public.inventory_barang_masuk bm, requested r
    where r.normalized_sku <> ''
      and public.inventory_normalize_sku(bm.sku::text) = r.normalized_sku
  ), outbound as (
    select bk.sku::text raw_sku, bk.status::text status
    from public.inventory_barang_keluar bk, requested r
    where r.normalized_sku <> ''
      and public.inventory_normalize_sku(bk.sku::text) = r.normalized_sku
  )
  select jsonb_build_object(
    'sku', coalesce(p_sku, ''),
    'normalizedSku', r.normalized_sku,
    'requestedLength', char_length(coalesce(p_sku, '')),
    'barangMasuk', jsonb_build_object(
      'exists', exists(select 1 from inbound),
      'count', (select count(*) from inbound),
      'rawSkuValues', coalesce((select jsonb_agg(distinct raw_sku) from inbound), '[]'::jsonb),
      'normalizedSkuValues', coalesce((select jsonb_agg(distinct public.inventory_normalize_sku(raw_sku)) from inbound), '[]'::jsonb),
      'rawSkuLengths', coalesce((select jsonb_agg(distinct char_length(raw_sku)) from inbound), '[]'::jsonb),
      'statuses', coalesce((select jsonb_agg(distinct status) from inbound), '[]'::jsonb)
    ),
    'barangKeluar', jsonb_build_object(
      'exists', exists(select 1 from outbound),
      'count', (select count(*) from outbound),
      'rawSkuValues', coalesce((select jsonb_agg(distinct raw_sku) from outbound), '[]'::jsonb),
      'normalizedSkuValues', coalesce((select jsonb_agg(distinct public.inventory_normalize_sku(raw_sku)) from outbound), '[]'::jsonb),
      'rawSkuLengths', coalesce((select jsonb_agg(distinct char_length(raw_sku)) from outbound), '[]'::jsonb),
      'statuses', coalesce((select jsonb_agg(distinct status) from outbound), '[]'::jsonb)
    ),
    'warningShouldExist', exists(select 1 from outbound) and not exists(select 1 from inbound),
    'tables', jsonb_build_object(
      'barangMasuk', 'public.inventory_barang_masuk',
      'barangMasukSkuColumn', 'sku',
      'barangKeluar', 'public.inventory_barang_keluar',
      'barangKeluarSkuColumn', 'sku'
    )
  ) from requested r;
$$;

revoke all on function public.inventory_normalize_sku(text) from public;
revoke all on function public.inventory_outbound_without_inbound() from public;
revoke all on function public.inventory_sku_presence_debug(text) from public;
grant execute on function public.inventory_normalize_sku(text) to service_role;
grant execute on function public.inventory_outbound_without_inbound() to service_role;
grant execute on function public.inventory_sku_presence_debug(text) to service_role;
