-- Read current ledgers and reconstruct balances by reversing later movements.
-- Keep any existing archives untouched while retiring their scheduled capture.
create or replace function public.read_inventory_daily_history(p_date date,p_kind text,p_query text,p_page integer)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with settings as (
  select coalesce(p_date,(statement_timestamp() at time zone 'Asia/Jakarta')::date) as day,
   (statement_timestamp() at time zone 'Asia/Jakarta')::date as today,
   case p_kind when 'stock' then 'kartu_stok' when 'rpl' then 'rpl' when 'bulky' then 'bulky' end as stock_source
 ), baseline as (
  select cfg.*, (s.last_success_at at time zone 'Asia/Jakarta')::date as basis_date,
   s.last_success_at as basis_at
  from settings cfg left join inventory_sync_status s on s.source=cfg.stock_source and s.status='success' and s.locked_at is null
 ), inbound as materialized (
  select t.sku::text as sku,t.nama_barang::text as name,t.from_location::text as origin,t.to_location::text as destination,
   t.qty::numeric as qty,t.status::text as status,t.pic::text as pic,t.keterangan::text as note,t.source_row_number,t.id::text as row_id,
   inventory_warning_date(t.tanggal::text) as date
  from inventory_barang_masuk t where p_kind<>'outbound'
 ), outbound(sku,name,origin,destination,qty,status,pic,note,source_row_number,row_id,date) as materialized (
  select t.sku::text,t.nama_barang::text,t.from_location::text,t.to_location::text,
   t.qty::numeric,t.status::text,t.pic::text,t.keterangan::text,t.source_row_number,t.id::text,
   inventory_warning_date(t.tanggal::text)
  from inventory_barang_keluar t where p_kind<>'inbound'
 ), coverage as (
  select min(date) as earliest from (select date from inbound union all select date from outbound) dates
 ), stock_available as (
  select b.*, c.earliest, b.basis_date is not null and b.day<=b.basis_date
   and (b.day=b.basis_date or (c.earliest is not null and b.day>=c.earliest and extract(year from b.day)=extract(year from b.basis_date))) as ready
  from baseline b cross join coverage c
 ), stock_rows as (
  select 'Kartu Stok' as source,sku::text,nama_barang::text as name,lokasi_bulky::text as location,stok_akhir::numeric as qty
  from inventory_kartu_stok where p_kind='stock'
  union all
  select 'RPL',sku::text,nama_barang::text,lokasi_bulky::text,stok_akhir::numeric from inventory_rpl where p_kind='rpl'
  union all
  select 'BULKY',sku::text,nama_barang::text,lokasi_bulky::text,stok_akhir::numeric from inventory_bulky where p_kind='bulky'
 ), later_transactions as (
  select t.sku,t.destination as location,t.qty as delta from inbound t cross join stock_available b
  where b.stock_source is not null and b.ready and t.date>b.day and t.date<=b.basis_date
  union all
  select t.sku,t.origin,-t.qty from inbound t cross join stock_available b
  where b.stock_source is not null and b.ready and t.date>b.day and t.date<=b.basis_date and lower(trim(coalesce(t.status,'')))='movement'
  union all
  select t.sku,t.origin,-t.qty from outbound t cross join stock_available b
  where b.stock_source is not null and b.ready and t.date>b.day and t.date<=b.basis_date
 ), later_changes as (
  select inventory_warning_normalize_sku(t.sku) as sku,upper(regexp_replace(trim(t.location),'[[:space:]]+',' ','g')) as location,
   sum(t.delta) as qty
  from later_transactions t
  where trim(coalesce(t.location,''))<>'' and trim(coalesce(t.sku,''))<>''
  group by 1,2
 ), stock_totals as (
  select s.source,inventory_warning_normalize_sku(s.sku) as sku,max(s.name) as name,
   upper(regexp_replace(trim(s.location),'[[:space:]]+',' ','g')) as location,
   case when count(s.qty)=count(*) then sum(s.qty) end as qty
  from stock_rows s cross join stock_available b
  where b.ready and trim(coalesce(s.sku,''))<>'' and trim(coalesce(s.location,''))<>''
  group by 1,2,4
 ), records as (
  select jsonb_build_object('sku',s.sku,'name',s.name,'location',s.location,'qty',s.qty-coalesce(delta.qty,0),'source',s.source) as item,
   null::date as sort_date,null::integer as source_row_number,s.sku||'|'||s.location as row_id
  from stock_totals s left join later_changes delta using(sku,location)
  union all
  select jsonb_build_object('date',t.date,'sku',t.sku,'name',t.name,'from',t.origin,'to',t.destination,'qty',t.qty,'status',t.status,'pic',t.pic,'note',t.note),
   t.date,t.source_row_number,t.row_id
  from (select * from inbound where p_kind='inbound' union all select * from outbound where p_kind='outbound') t
  cross join settings cfg
  where t.date<=cfg.day
 ), matches as materialized (
  select * from records
  where strpos(lower(concat_ws(' ',item->>'sku',item->>'name',item->>'location',item->>'from',item->>'to',item->>'source',item->>'status',item->>'pic',item->>'note',item->>'date')),lower(coalesce(p_query,'')))>0
 ), result_size as (select count(*) as total from matches),
 page_info as (select total,least(greatest(1,coalesce(p_page,1)),greatest(1,ceil(total/50.0)::int)) as page from result_size)
 select jsonb_build_object('date',b.day,'earliestDate',b.earliest,'latestDate',b.today,'basisAt',b.basis_at,'basisDate',b.basis_date,
  'stockAvailable',b.stock_source is null or b.ready,'total',page_info.total,'page',page_info.page,
  'rows',coalesce((select jsonb_agg(item order by sort_date desc nulls last,source_row_number desc nulls last,row_id) from
    (select * from matches order by sort_date desc nulls last,source_row_number desc nulls last,row_id
     limit 50 offset (select (page-1)*50 from page_info)) visible),'[]'::jsonb))
 from stock_available b,page_info;
$$;

revoke all on function public.read_inventory_daily_history(date,text,text,integer) from public,anon,authenticated;
grant execute on function public.read_inventory_daily_history(date,text,text,integer) to service_role;
notify pgrst,'reload schema';
