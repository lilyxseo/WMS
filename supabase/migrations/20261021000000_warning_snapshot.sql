create table if not exists public.inventory_warning_snapshot(
 id boolean primary key default true check(id), payload jsonb, published_at timestamptz,
 last_attempt_at timestamptz, last_error text, run uuid, lease_until timestamptz
);
insert into public.inventory_warning_snapshot(id) values(true) on conflict do nothing;
alter table public.inventory_warning_snapshot enable row level security;
revoke all on public.inventory_warning_snapshot from public,anon,authenticated;
grant select,insert,update,delete on public.inventory_warning_snapshot to service_role;
create or replace function public.warning_snapshot_claim(p_run uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 update inventory_warning_snapshot set run=p_run,lease_until=now()+interval '5 minutes',last_attempt_at=now()
 where id and (run is null or lease_until<now());return found;
end$$;
create or replace function public.warning_snapshot_publish(p_run uuid,p_payload jsonb) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous jsonb; ready integer; limited boolean;
begin
 select payload into previous from inventory_warning_snapshot where id and run=p_run and lease_until>now() for update;
 if not found then raise exception 'Snapshot lease unavailable';end if;
 if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_typeof(p_payload->'verification') is distinct from 'array' or p_payload->>'checkedAt' is null then raise exception 'Invalid snapshot';end if;
 select count(*) into ready from jsonb_array_elements(p_payload->'verification') item where item->>'ready'='true';
 limited:=ready<5 or jsonb_array_length(coalesce(p_payload->'unavailableSources','[]'::jsonb))>0;
 if ready=0 or (previous is not null and limited) then
  update inventory_warning_snapshot set last_error='Pemeriksaan terbaru belum lengkap; hasil sebelumnya dipertahankan.',run=null,lease_until=null where id;return false;
 end if;
 update inventory_warning_snapshot set payload=p_payload,published_at=now(),last_error=null,run=null,lease_until=null where id;return true;
end$$;
create or replace function public.warning_snapshot_fail(p_run uuid) returns void
language sql security invoker set search_path=public,pg_temp as $$
 update inventory_warning_snapshot set last_error='Pemeriksaan server belum berhasil; hasil sebelumnya dipertahankan.',run=null,lease_until=null where id and run=p_run;
$$;
create or replace function public.dispatch_warning_snapshot() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare secret text; endpoint text; request_id bigint;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='wms_warning_snapshot_secret' limit 1;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='wms_warning_snapshot_url' limit 1;
 if secret is null or endpoint is null then return null;end if;
 select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','X-WMS-Snapshot-Secret',secret),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;return request_id;
end$$;
revoke all on function public.warning_snapshot_claim(uuid),public.warning_snapshot_publish(uuid,jsonb),public.warning_snapshot_fail(uuid),public.dispatch_warning_snapshot() from public,anon,authenticated;
grant execute on function public.warning_snapshot_claim(uuid),public.warning_snapshot_publish(uuid,jsonb),public.warning_snapshot_fail(uuid) to service_role;
notify pgrst,'reload schema';

-- One PostgreSQL MVCC snapshot binds stock rows, source fingerprints and history.
create or replace function public.inventory_warning_detection_data() returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare item record; stocks jsonb:='{}'; data jsonb; ledger jsonb; movement jsonb; ledger_ok boolean:=true; movement_ok boolean:=true;
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
 return jsonb_build_object('stocks',stocks,'sync',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.inventory_sync_status t),
 'signatures',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.inventory_warning_snapshot_signatures() t),'ledger',ledger,'ledgerAvailable',ledger_ok,'movement',movement,'movementAvailable',movement_ok);
end$$;
revoke all on function public.inventory_warning_detection_data() from public,anon,authenticated;
grant execute on function public.inventory_warning_detection_data() to service_role;
notify pgrst,'reload schema';
