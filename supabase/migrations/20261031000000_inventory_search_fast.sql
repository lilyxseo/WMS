-- One authenticated server RPC; no Google Sheets requests in the query path.
create or replace function public.wms_inventory_search(p_query text,p_source text default '',p_limit integer default 100)
returns table(sku text,nama text,sources jsonb,summary jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
 with raw as not materialized (
 select 'Kartu Stock'::text source,sku::text,nama_barang::text nama,lokasi_bulky::text location,stok_akhir::numeric qty,''::text destination from inventory_kartu_stok
 union all select 'RPL',sku,nama_barang,lokasi_bulky,stok_akhir::numeric,'' from inventory_rpl
 union all select 'BULKY',sku,nama_barang,lokasi_bulky,stok_akhir::numeric,'' from inventory_bulky
 union all select 'Barang Masuk',sku,nama_barang,from_location,0::numeric,to_location from inventory_barang_masuk
 union all select 'Barang Keluar',sku,nama_barang,from_location,0::numeric,to_location from inventory_barang_keluar
 ), tokens as (select value from regexp_split_to_table(lower(trim(p_query)),'\s+') value where value<>''),
 candidates as (
 select upper(trim(r.sku)) key from raw r where length(trim(p_query)) between 2 and 200 and trim(coalesce(r.sku,''))<>'' and (coalesce(p_source,'')='' or r.source=p_source)
 and not exists(select 1 from tokens t where position(t.value in lower(concat_ws(' ',r.sku,r.nama,r.location,r.destination)))=0)
 group by upper(trim(r.sku)) order by (upper(trim(r.sku))=upper(trim(p_query))) desc,upper(trim(r.sku)) limit least(100,greatest(1,p_limit))
 ), matched as materialized (select r.* from raw r join candidates c on c.key=upper(trim(r.sku)) where coalesce(p_source,'')='' or r.source=p_source),
 products as (select upper(trim(m.sku)) key,min(m.sku) sku,min(m.nama) nama,jsonb_agg(distinct m.source) sources from matched m group by upper(trim(m.sku))),
 distribution as (select upper(trim(m.sku)) key,m.source,sum(coalesce(m.qty,0)) qty from matched m where m.source in ('Kartu Stock','RPL','BULKY') group by upper(trim(m.sku)),m.source),
 locations as (select upper(trim(m.sku)) key,trim(m.location) location,sum(coalesce(m.qty,0)) qty from matched m where m.source in ('Kartu Stock','RPL','BULKY') and trim(coalesce(m.location,''))<>'' group by upper(trim(m.sku)),trim(m.location))
 select p.sku,p.nama,p.sources,jsonb_build_object('distribution',jsonb_build_object('Kartu Stock',coalesce((select d.qty from distribution d where d.key=p.key and d.source='Kartu Stock'),0),'RPL',coalesce((select d.qty from distribution d where d.key=p.key and d.source='RPL'),0),'BULKY',coalesce((select d.qty from distribution d where d.key=p.key and d.source='BULKY'),0)),
 'locations',coalesce((select jsonb_agg(l.location order by l.location) from locations l where l.key=p.key and l.qty>0),'[]'::jsonb),
 'locationStocks',coalesce((select jsonb_agg(jsonb_build_object('location',l.location,'qty',l.qty) order by l.location) from locations l where l.key=p.key),'[]'::jsonb))
 from products p order by (p.key=upper(trim(p_query))) desc,p.key;
$$;
revoke all on function public.wms_inventory_search(text,text,integer) from public,anon,authenticated;
grant execute on function public.wms_inventory_search(text,text,integer) to service_role;
notify pgrst,'reload schema';
-- Shared direct lookups (entry, movement, cycle count, locations, ledgers)
-- retain their existing contracts and benefit from indexed contains searches.
do $$declare tab text; col text; ext_schema text;begin
 select n.nspname into ext_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
 if ext_schema is null then raise exception 'pg_trgm is required';end if;
 foreach tab in array array['inventory_kartu_stok','inventory_rpl','inventory_bulky','inventory_barang_masuk','inventory_barang_keluar'] loop
  foreach col in array array['sku','nama_barang','lokasi_bulky','from_location','to_location'] loop
   if exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||tab) and attname=col and not attisdropped and atttypid in ('text'::regtype,'varchar'::regtype)) then
    execute format('create index if not exists %I on public.%I using gin (%I %I.gin_trgm_ops)',tab||'_'||col||'_search_trgm',tab,col,ext_schema);
   end if;
  end loop;
 end loop;
end$$;
