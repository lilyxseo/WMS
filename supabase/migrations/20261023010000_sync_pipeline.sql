alter table public.inventory_sync_status add column if not exists last_full_sync_at timestamptz;
create or replace function public.acquire_inventory_sync_fast(p_source text,p_lock_id uuid,p_stale_after_seconds integer default 120) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.inventory_sync_status%rowtype; acquired boolean;
begin
 select * into prior from public.inventory_sync_status where source=p_source for update;
 acquired:=public.acquire_inventory_sync_lock(p_source,p_lock_id,p_stale_after_seconds);
 return jsonb_build_object('acquired',acquired,'source_version',prior.source_version,'allow_fast',acquired and prior.status='success' and prior.locked_at is null and prior.last_full_sync_at>now()-interval '10 minutes');
end$$;
create or replace function public.finish_inventory_sync_fast(p_source text,p_lock_id uuid,p_row_count integer,p_inserted_count integer,p_updated_count integer,p_deleted_count integer,p_duration_ms integer,p_source_version text,p_full boolean default true) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.inventory_sync_status where source=p_source and lock_id=p_lock_id and locked_at is not null for update;
 if not found then raise exception 'Sync lease unavailable';end if;
 perform public.finish_inventory_sync_success(p_source,p_lock_id,p_row_count,p_inserted_count,p_updated_count,p_deleted_count,p_duration_ms,p_source_version);
 if p_full then update public.inventory_sync_status set last_full_sync_at=now() where source=p_source and source_version=p_source_version and locked_at is null;end if;
end$$;
create or replace function public.inventory_client_versions() returns jsonb language sql stable security definer set search_path=public as $$
 select (select jsonb_object_agg(mapping.key,coalesce(s.source_version,'unsynced')) from (values
 ('barangMasukVersion','barang_masuk'),('barangKeluarVersion','barang_keluar'),('kartuStokVersion','kartu_stok'),('rplVersion','rpl'),('bulkyVersion','bulky'),('netsuiteVersion','netsuite')) mapping(key,source)
 left join public.inventory_sync_status s on s.source=mapping.source)
 || jsonb_build_object('warningVersion',coalesce((select published_at::text from public.inventory_warning_snapshot where id),'unavailable'),'updatedAt',now(),'syncStatus',(select jsonb_build_object('source',source,'status',status,'last_success_at',last_success_at,'locked_at',locked_at) from public.inventory_sync_status where last_success_at is not null order by last_success_at desc limit 1));
$$;
create table if not exists public.inventory_refresh_requests(source text primary key check(source in ('barang_masuk','barang_keluar','kartu_stok','rpl','bulky','netsuite')),requested_at timestamptz not null default now(),dispatched_at timestamptz,last_error text);
alter table public.inventory_refresh_requests enable row level security;
revoke all on public.inventory_refresh_requests from public,anon,authenticated;
grant select,insert,update on public.inventory_refresh_requests to service_role;
create or replace function public.request_inventory_refresh(p_sources text[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare src text; slug text; template text; previous_dispatch timestamptz; dispatched integer:=0;
begin
 if p_sources is null or cardinality(p_sources)<1 or cardinality(p_sources)>6 or exists(select 1 from unnest(p_sources) value where value is null or value not in ('barang_masuk','barang_keluar','kartu_stok','rpl','bulky','netsuite')) then raise exception 'Invalid refresh sources';end if;
 for src in select distinct value from unnest(p_sources) value loop
  insert into public.inventory_refresh_requests(source) values(src) on conflict(source) do update set requested_at=now();
  select dispatched_at into previous_dispatch from public.inventory_refresh_requests where source=src for update;
  if previous_dispatch>now()-interval '15 seconds' then continue;end if;
  slug:=replace(src,'_','-');
  if src='netsuite' then template:='select public.dispatch_netsuite_sync()';else
   select command into template from cron.job where active and command like '%/api/sync/inventory/'||slug||'%' order by jobid limit 1;
  end if;
  if template is null then update public.inventory_refresh_requests set last_error='SCHEDULE_TEMPLATE_MISSING' where source=src;continue;end if;
  begin
   execute template;
   update public.inventory_refresh_requests set dispatched_at=now(),last_error=null where source=src;
   dispatched:=dispatched+1;
  exception when others then update public.inventory_refresh_requests set last_error='DISPATCH_FAILED' where source=src;
  end;
 end loop;
 return jsonb_build_object('requested',cardinality(p_sources),'dispatched',dispatched);
end$$;
revoke all on function public.acquire_inventory_sync_fast(text,uuid,integer),public.finish_inventory_sync_fast(text,uuid,integer,integer,integer,integer,integer,text,boolean),public.inventory_client_versions(),public.request_inventory_refresh(text[]) from public,anon,authenticated;
grant execute on function public.acquire_inventory_sync_fast(text,uuid,integer),public.finish_inventory_sync_fast(text,uuid,integer,integer,integer,integer,integer,text,boolean),public.inventory_client_versions(),public.request_inventory_refresh(text[]) to service_role;
notify pgrst,'reload schema';
