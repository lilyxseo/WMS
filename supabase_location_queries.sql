-- Location page read model. Run this migration in Supabase before deploying the UI.
-- It deliberately mirrors the existing Location Analysis rules: Kartu Stock only,
-- positive aggregated ending stock, plus the generated A01-1..H20-5 master (except
-- every zone's 07-1..07-3 locations).

create or replace function public.location_inventory_rows()
returns table (lokasi text, sku text, nama text, qty numeric)
language sql stable security definer set search_path = public as $$
  select upper(trim(lokasi_bulky)), trim(sku), coalesce(max(nullif(trim(nama_barang), '')), '-'), sum(coalesce(stok_akhir, 0))
  from public.inventory_kartu_stok
  where nullif(trim(sku), '') is not null and nullif(trim(lokasi_bulky), '') is not null
  group by upper(trim(lokasi_bulky)), trim(sku)
  having sum(coalesce(stok_akhir, 0)) > 0
$$;

create or replace function public.location_groups()
returns table (lokasi text, jumlah_sku bigint, total_qty numeric, status text)
language sql stable security definer set search_path = public as $$
  with master as (
    select chr(zone)::text || lpad(slot::text, 2, '0') || '-' || floor::text as lokasi
    from generate_series(65,72) zone, generate_series(1,20) slot, generate_series(1,5) floor
    where not (slot = 7 and floor between 1 and 3)
  ), grouped as (
    select r.lokasi, count(*)::bigint jumlah_sku, sum(r.qty)::numeric total_qty
    from public.location_inventory_rows() r group by r.lokasi
  )
  select locations.lokasi, coalesce(g.jumlah_sku,0), coalesce(g.total_qty,0),
    case when coalesce(g.total_qty,0)=0 or coalesce(g.jumlah_sku,0)=0 then 'Kosong'
         when g.jumlah_sku>=5 or g.total_qty>=100 then 'Padat'
         when g.jumlah_sku<=2 or g.total_qty<=10 then 'Sedikit' else 'Normal' end
  from (select lokasi from master union select lokasi from grouped) locations
  left join grouped g using (lokasi)
$$;

create or replace function public.location_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'totalLocations', (select count(*) from public.location_groups()),
    'totalLocatedSku', (select count(distinct sku) from public.location_inventory_rows()),
    'emptyLocations', (select count(*) from public.location_groups() where status='Kosong')
  )
$$;

create or replace function public.location_list(p_page integer default 1, p_limit integer default 25,
  p_search text default '', p_sku_search text default '', p_status text default 'all',
  p_location_type text default 'all', p_sort text default 'sku-desc')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  with filtered as (
    select g.* from public.location_groups() g
    where (p_search='' or g.lokasi ilike '%'||p_search||'%')
      and (p_status='all' or g.status=p_status)
      and (p_location_type='all' or (p_location_type='bulky' and length(g.lokasi)=5) or (p_location_type='retail' and length(g.lokasi)=8))
      and (p_sku_search='' or exists (select 1 from public.location_inventory_rows() r where r.lokasi=g.lokasi and (r.sku ilike '%'||p_sku_search||'%' or r.nama ilike '%'||p_sku_search||'%')))
  ), ordered as (
    select lokasi,jumlah_sku,total_qty,status from filtered order by
      case when p_sort='sku-desc' then jumlah_sku end desc, case when p_sort='sku-asc' then jumlah_sku end asc,
      case when p_sort='qty-desc' then total_qty end desc, case when p_sort='qty-asc' then total_qty end asc,
      case when p_sort='location-asc' then lokasi end asc, jumlah_sku desc, total_qty desc, lokasi asc
    offset (greatest(p_page,1)-1)*least(greatest(p_limit,1),25) limit least(greatest(p_limit,1),25)
  ) select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('lokasi',lokasi,'jumlahSku',jumlah_sku,'totalQty',total_qty,'status',status)),'[]'),
      'total',(select count(*) from filtered),'page',greatest(p_page,1),'limit',least(greatest(p_limit,1),25)) into result from ordered;
  return result;
end $$;

create or replace function public.location_empty(p_page integer default 1, p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = public as $$
  with empty_rows as (select lokasi from public.location_groups() where status='Kosong' order by lokasi), page_rows as
  (select lokasi from empty_rows offset (greatest(p_page,1)-1)*least(greatest(p_limit,1),25) limit least(greatest(p_limit,1),25))
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('lokasi',lokasi)) from page_rows),'[]'),
    'total',(select count(*) from empty_rows),'page',greatest(p_page,1),'limit',least(greatest(p_limit,1),25))
$$;

create or replace function public.location_detail(p_lokasi text, p_page integer default 1, p_limit integer default 25,
  p_search text default '') returns jsonb language sql stable security definer set search_path = public as $$
  with found as (select sku,nama,qty from public.location_inventory_rows() where lokasi=upper(trim(p_lokasi))
    and (p_search='' or sku ilike '%'||p_search||'%' or nama ilike '%'||p_search||'%')),
  page_rows as (select sku,nama,qty from found order by qty desc,sku asc offset (greatest(p_page,1)-1)*least(greatest(p_limit,1),25) limit least(greatest(p_limit,1),25))
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'nama',nama,'qty',qty)) from page_rows),'[]'),
    'total',(select count(*) from found),'page',greatest(p_page,1),'limit',least(greatest(p_limit,1),25),'lokasi',upper(trim(p_lokasi)))
$$;
