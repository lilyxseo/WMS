-- Parse the supported sheet date formats without guessing locale or allowing
-- invalid calendar dates to normalize into a different month.
create or replace function public.inventory_warning_date(value text)
returns date language plpgsql immutable parallel safe as $$
declare parts text[];
begin
 parts:=regexp_match(btrim(coalesce(value,'')),'^(\d{4})-(\d{2})-(\d{2})$');
 if parts is not null then return make_date(parts[1]::integer,parts[2]::integer,parts[3]::integer);end if;
 parts:=regexp_match(btrim(coalesce(value,'')),'^(\d{1,2})/(\d{1,2})/(\d{4})$');
 if parts is not null then return make_date(parts[3]::integer,parts[1]::integer,parts[2]::integer);end if;
 return null;
exception when others then return null;
end $$;

-- Return a scalar JSON object so PostgREST's row cap cannot truncate transfers.
-- Only movement business fields and compact subsequent-activity summaries are
-- returned. No profile, document, or external reference fields are read.
create or replace function public.inventory_warning_movement_context()
returns jsonb language sql stable security definer set search_path=public as $$
 with moves as materialized (
  select sku::text,nama_barang::text,qty,tanggal::text,from_location::text,to_location::text,
   status::text,keterangan::text,source_row_number,synced_at
  from public.inventory_barang_masuk
  where upper(btrim(coalesce(keterangan::text,''))) in ('INTERNAL STOCK TRANSFER','REPLENISHMENT')
    or upper(btrim(coalesce(status::text,'')))='MOVEMENT'
 ), skus as (select distinct public.inventory_warning_normalize_sku(sku) sku from moves), activity as (
  select public.inventory_warning_normalize_sku(b.sku::text) sku,b.to_location::text location,
   public.inventory_warning_date(b.tanggal::text) event_date
  from public.inventory_barang_masuk b join skus s on s.sku=public.inventory_warning_normalize_sku(b.sku::text)
  where b.qty>0 and upper(btrim(coalesce(b.keterangan::text,''))) not in ('INTERNAL STOCK TRANSFER','REPLENISHMENT')
    and upper(btrim(coalesce(b.status::text,'')))<>'MOVEMENT'
  union all
  select public.inventory_warning_normalize_sku(b.sku::text),b.from_location::text,
   public.inventory_warning_date(b.tanggal::text)
  from public.inventory_barang_keluar b join skus s on s.sku=public.inventory_warning_normalize_sku(b.sku::text)
  where b.qty>0
 ), summaries as (
  select sku,location,max(event_date) last_date,bool_or(event_date is null) unknown_date
  from activity group by sku,location
 )
 select jsonb_build_object('movements',coalesce((select jsonb_agg(to_jsonb(m)) from moves m),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(to_jsonb(a)) from summaries a),'[]'::jsonb));
$$;
revoke all on function public.inventory_warning_movement_context() from public,anon,authenticated;
grant execute on function public.inventory_warning_movement_context() to service_role;
notify pgrst,'reload schema';
