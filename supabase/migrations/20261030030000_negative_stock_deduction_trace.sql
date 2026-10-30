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

-- Only negative SKU/location keys and at most 50 matching deductions per stock row.
create or replace function public.inventory_warning_negative_context() returns jsonb
language sql stable security definer set search_path=public as $$
 with negative as materialized (
  select s.*,public.inventory_warning_normalize_sku(s.sku::text) sku_key,upper(btrim(s.lokasi_bulky::text)) location_key
  from public.inventory_kartu_stok s where s.stok_akhir<0
 ), keys as (select distinct sku_key,location_key from negative), deductions as materialized (
  select public.inventory_warning_normalize_sku(t.sku::text) sku_key,upper(btrim(t.from_location::text)) location_key,
   'Barang Keluar'::text source,t.sku::text,t.from_location::text as origin,t.to_location::text as destination,t.qty,t.tanggal::text,t.source_row_number,public.inventory_warning_date(t.tanggal::text) event_date
  from public.inventory_barang_keluar t join keys k on k.sku_key=public.inventory_warning_normalize_sku(t.sku::text) and k.location_key=upper(btrim(t.from_location::text)) where t.qty>0
  union all
  select public.inventory_warning_normalize_sku(t.sku::text),upper(btrim(t.from_location::text)),
   'Barang Masuk',t.sku::text,t.from_location::text,t.to_location::text,t.qty,t.tanggal::text,t.source_row_number,public.inventory_warning_date(t.tanggal::text)
  from public.inventory_barang_masuk t join keys k on k.sku_key=public.inventory_warning_normalize_sku(t.sku::text) and k.location_key=upper(btrim(t.from_location::text))
  where t.qty>0 and (upper(btrim(coalesce(to_jsonb(t)->>'keterangan',''))) in ('INTERNAL STOCK TRANSFER','REPLENISHMENT') or upper(btrim(coalesce(to_jsonb(t)->>'status','')))='MOVEMENT')
 ), contexts as (
  select jsonb_build_object('sku',n.sku,'location',n.lokasi_bulky,'stockRow',n.source_row_number,
   'opening',to_jsonb(n)->'stok_awal','closing',n.stok_akhir,'outgoing',to_jsonb(n)->'pengeluaran','transfer',to_jsonb(n)->'internal_stock_transfer','replenishment',to_jsonb(n)->'replenishment',
   'stockRows',(select count(*) from public.inventory_kartu_stok s where public.inventory_warning_normalize_sku(s.sku::text)=n.sku_key and upper(btrim(s.lokasi_bulky::text))=n.location_key),
   'total',(select count(*) from deductions d where d.sku_key=n.sku_key and d.location_key=n.location_key),
   'unknownDates',coalesce((select bool_or(d.event_date is null) from deductions d where d.sku_key=n.sku_key and d.location_key=n.location_key),true),
   'laterIncoming',exists(select 1 from public.inventory_barang_masuk t where t.qty>0 and public.inventory_warning_normalize_sku(t.sku::text)=n.sku_key and upper(btrim(t.to_location::text))=n.location_key
     and (public.inventory_warning_date(t.tanggal::text) is null or public.inventory_warning_date(t.tanggal::text)>=(select min(d.event_date) from deductions d where d.sku_key=n.sku_key and d.location_key=n.location_key))),
   'transactions',coalesce((select jsonb_agg(jsonb_build_object('source',d.source,'sku',d.sku,'from',d.origin,'to',d.destination,'qty',d.qty,'date',d.tanggal,'eventDate',d.event_date,'row',d.source_row_number) order by d.event_date desc nulls last,d.source_row_number desc)
    from (select * from deductions d where d.sku_key=n.sku_key and d.location_key=n.location_key order by d.event_date desc nulls last,d.source_row_number desc limit 50) d),'[]')
  ) data from negative n
 ) select coalesce(jsonb_agg(data),'[]') from contexts;
$$;
revoke all on function public.inventory_warning_negative_context() from public,anon,authenticated;
grant execute on function public.inventory_warning_negative_context() to service_role;
create or replace function public.inventory_warning_detection_data() returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare item record; stocks jsonb:='{}'; data jsonb; ledger jsonb; movement jsonb; outbound_from jsonb;negative_context jsonb;negative_ok boolean:=true; outbound_from_ok boolean:=true; ledger_ok boolean:=true; movement_ok boolean:=true;
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
 begin select public.inventory_warning_negative_context() into negative_context;exception when others then negative_context:='[]';negative_ok:=false;end;
 return jsonb_build_object('negativeContext',negative_context,'negativeContextAvailable',negative_ok,'outboundFrom',outbound_from,'outboundFromAvailable',outbound_from_ok,'stocks',stocks,'sync',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.inventory_sync_status t),
 'signatures',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.inventory_warning_snapshot_signatures() t),'ledger',ledger,'ledgerAvailable',ledger_ok,'movement',movement,'movementAvailable',movement_ok);
end$$;
revoke all on function public.inventory_warning_detection_data() from public,anon,authenticated;
grant execute on function public.inventory_warning_detection_data() to service_role;
notify pgrst,'reload schema';
