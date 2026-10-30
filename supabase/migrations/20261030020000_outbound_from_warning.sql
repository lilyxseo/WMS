-- Candidate reduction happens in PostgreSQL; no full outbound ledger in the Worker.
create or replace function public.inventory_warning_outbound_from_review()
returns table(sku text,nama_barang text,qty numeric,source_row_number integer,tanggal text,from_location text,to_location text,reason text)
language sql stable security definer set search_path=public as $$
 with locations as materialized (
  select distinct upper(regexp_replace(btrim(coalesce(lokasi_bulky::text,'')),'[[:space:]]+',' ','g')) as location from public.inventory_kartu_stok
 ), candidates as (
  select bk.*,upper(regexp_replace(btrim(coalesce(bk.from_location::text,'')),'[[:space:]]+',' ','g')) as normalized_from
  from public.inventory_barang_keluar bk where bk.qty>0 and btrim(coalesce(bk.sku::text,''))<>''
 )
 select bk.sku::text,bk.nama_barang::text,bk.qty::numeric,bk.source_row_number::integer,bk.tanggal::text,bk.from_location::text,bk.to_location::text,
  case when bk.normalized_from='' then 'empty' when bk.normalized_from ~ '[,;|/+&]' or bk.from_location::text ~ E'[\\n\\r]' then 'multiple' else 'unknown' end
 from candidates bk where bk.normalized_from='' or bk.normalized_from ~ '[,;|/+&]' or bk.from_location::text ~ E'[\\n\\r]'
 or (bk.normalized_from !~ '^[A-H](0[1-9]|1[0-9]|20)-[1-5]$' and not exists(select 1 from locations l where l.location=bk.normalized_from))
 order by bk.source_row_number;
$$;
revoke all on function public.inventory_warning_outbound_from_review() from public,anon,authenticated;
grant execute on function public.inventory_warning_outbound_from_review() to service_role;
create or replace function public.inventory_warning_detection_data() returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare item record; stocks jsonb:='{}'; data jsonb; ledger jsonb; movement jsonb; outbound_from jsonb; outbound_from_ok boolean:=true; ledger_ok boolean:=true; movement_ok boolean:=true;
begin
 for item in select * from (values('kartuStok','inventory_kartu_stok'),('rpl','inventory_rpl'),('bulky','inventory_bulky')) names(key,relation) loop
  execute format($q$select coalesce(jsonb_agg(jsonb_build_object(
   'id',j->'id','sku',j->'sku','nama_barang',j->'nama_barang','lokasi_bulky',j->'lokasi_bulky','stok_akhir',j->'stok_akhir','source_row_number',j->'source_row_number',
   'stok_awal',j->'stok_awal','internal_stock_transfer',j->'internal_stock_transfer','replenishment',j->'replenishment','pengeluaran',j->'pengeluaran','netsuite',j->'netsuite','selisih',j->'selisih'
  ) order by (j->>'source_row_number')::bigint,j->>'id'),'[]') from (select to_jsonb(t) j from public.%I t) items$q$,item.relation) into data;
  stocks:=jsonb_set(stocks,array[item.key],data);
 end loop;
 begin select coalesce(jsonb_agg(to_jsonb(t)),'[]') into ledger from public.inventory_warning_ledger_review() t;exception when others then ledger:='[]';ledger_ok:=false;end;
 begin select public.inventory_warning_movement_context() into movement;exception when others then movement:=null;movement_ok:=false;end;
 begin select coalesce(jsonb_agg(to_jsonb(t)),'[]') into outbound_from from public.inventory_warning_outbound_from_review() t;exception when others then outbound_from:='[]';outbound_from_ok:=false;end;
 return jsonb_build_object('outboundFrom',outbound_from,'outboundFromAvailable',outbound_from_ok,'stocks',stocks,'sync',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.inventory_sync_status t),
 'signatures',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.inventory_warning_snapshot_signatures() t),'ledger',ledger,'ledgerAvailable',ledger_ok,'movement',movement,'movementAvailable',movement_ok);
end$$;
revoke all on function public.inventory_warning_detection_data() from public,anon,authenticated;
grant execute on function public.inventory_warning_detection_data() to service_role;
notify pgrst,'reload schema';
