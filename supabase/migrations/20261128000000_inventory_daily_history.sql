create table if not exists public.inventory_daily_history (
 snapshot_date date primary key,
 captured_at timestamptz not null,
 stock jsonb not null,
 inbound jsonb not null,
 outbound jsonb not null
);

alter table public.inventory_daily_history enable row level security;
revoke all on table public.inventory_daily_history from public,anon,authenticated;
grant select,insert,update on table public.inventory_daily_history to service_role;

create or replace function public.capture_inventory_daily_history() returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 capture_at timestamptz:=statement_timestamp();
 local_time timestamp:=capture_at at time zone 'Asia/Jakarta';
 business_day date:=local_time::date;
 wrote boolean;
begin
 if not pg_try_advisory_xact_lock(298244,20261128) then return false;end if;
 if exists(select 1 from inventory_daily_history
  where snapshot_date=business_day and (captured_at at time zone 'Asia/Jakarta')::time >= time '23:55') then return false;end if;
 -- The proof and copied rows share a single MVCC statement snapshot.
 with verified as materialized (
  select count(distinct s.source)=5 as ready
  from inventory_sync_status s
  join inventory_warning_snapshot_signatures() proof on proof.source=s.source
  where s.source in ('kartu_stok','rpl','bulky','barang_masuk','barang_keluar')
   and s.status in ('success','syncing') and s.source_version=proof.content_version
   and s.last_success_at between capture_at-interval '45 minutes' and capture_at
 ), captured as (
  insert into inventory_daily_history(snapshot_date,captured_at,stock,inbound,outbound)
  select business_day,capture_at,
   (select coalesce(jsonb_agg(jsonb_build_object('sku',sku,'name',nama_barang,'location',lokasi_bulky,'qty',stok_akhir,'source',source)
    order by source,source_row_number,sku,coalesce(lokasi_bulky::text,'')),'[]'::jsonb)
    from (
     select 'Kartu Stok' as source,sku,nama_barang,lokasi_bulky,stok_akhir,source_row_number from inventory_kartu_stok
     union all select 'RPL',sku,nama_barang,lokasi_bulky,stok_akhir,source_row_number from inventory_rpl
     union all select 'BULKY',sku,nama_barang,lokasi_bulky,stok_akhir,source_row_number from inventory_bulky
    ) items where btrim(coalesce(sku::text,''))<>''),
   (select coalesce(jsonb_agg(jsonb_build_object('sku',sku,'name',nama_barang,'from',from_location,'to',to_location,'qty',qty,'status',status,'pic',pic,'note',keterangan)
    order by source_row_number desc,id),'[]'::jsonb) from inventory_barang_masuk
    where inventory_warning_date(tanggal::text)=business_day),
   (select coalesce(jsonb_agg(jsonb_build_object('sku',sku,'name',nama_barang,'from',from_location,'to',to_location,'qty',qty,'status',status,'pic',pic,'note',keterangan)
    order by source_row_number desc,id),'[]'::jsonb) from inventory_barang_keluar
    where inventory_warning_date(tanggal::text)=business_day)
  from verified where ready
  on conflict(snapshot_date) do update set captured_at=excluded.captured_at,stock=excluded.stock,inbound=excluded.inbound,outbound=excluded.outbound
  where inventory_daily_history.captured_at<excluded.captured_at
  returning true
 ) select exists(select 1 from captured) into wrote;
 return wrote;
end
$$;

create or replace function public.read_inventory_daily_history(p_date date,p_kind text,p_query text,p_page integer)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with dates as (select min(snapshot_date) as earliest,max(snapshot_date) as latest from inventory_daily_history),
 snapshot as (
  select h.* from inventory_daily_history h,dates where h.snapshot_date=coalesce(p_date,dates.latest)
 ), matches as materialized (
  select item,position from snapshot,
   jsonb_array_elements(case p_kind when 'inbound' then inbound when 'outbound' then outbound else stock end) with ordinality as items(item,position)
  where strpos(lower(concat_ws(' ',item->>'sku',item->>'name',item->>'location',item->>'from',item->>'to',item->>'source',item->>'status',item->>'pic',item->>'note')),lower(coalesce(p_query,'')))>0
 ), result_size as (select count(*) as total from matches),
 page_info as (select total, least(greatest(1,coalesce(p_page,1)),greatest(1,ceil(total/50.0)::int)) as page from result_size)
 select jsonb_build_object('date',coalesce(p_date,dates.latest),'earliestDate',dates.earliest,'latestDate',dates.latest,
  'capturedAt',(select captured_at from snapshot),'total',page_info.total,'page',page_info.page,
  'rows',coalesce((select jsonb_agg(item order by position) from
   (select item,position from matches order by position limit 50 offset (select (page-1)*50 from page_info)) visible),'[]'::jsonb))
 from dates,page_info;
$$;

revoke all on function public.capture_inventory_daily_history(),public.read_inventory_daily_history(date,text,text,integer) from public,anon,authenticated;
grant execute on function public.capture_inventory_daily_history(),public.read_inventory_daily_history(date,text,text,integer) to service_role;
notify pgrst,'reload schema';
