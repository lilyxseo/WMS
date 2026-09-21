-- Apply normalized multi-word AND / multi-field OR search before location pagination.
create or replace function public.location_list(p_page integer default 1, p_limit integer default 25,
  p_search text default '', p_sku_search text default '', p_status text default 'all',
  p_location_type text default 'all', p_sort text default 'sku-desc')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  with filtered as (
    select g.* from public.location_groups() g
    where (btrim(p_search)='' or not exists (
        select 1 from regexp_split_to_table(lower(btrim(p_search)), '\s+') token
        where not (g.lokasi ilike '%'||token||'%' or exists (
          select 1 from public.location_inventory_rows() r where r.lokasi=g.lokasi
          and (r.sku ilike '%'||token||'%' or r.nama ilike '%'||token||'%')))
      ))
      and (p_status='all' or g.status=p_status)
      and (p_location_type='all' or (p_location_type='bulky' and length(g.lokasi)=5) or (p_location_type='retail' and length(g.lokasi)=8))
      and (btrim(p_sku_search)='' or not exists (
        select 1 from regexp_split_to_table(lower(btrim(p_sku_search)), '\s+') token
        where not exists (select 1 from public.location_inventory_rows() r where r.lokasi=g.lokasi
          and (r.sku ilike '%'||token||'%' or r.nama ilike '%'||token||'%'))
      ))
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
