create table if not exists public.reject_write_lock (
 id integer primary key check(id=1),
 run uuid not null,
 expires_at timestamptz not null
);
alter table public.reject_write_lock enable row level security;
revoke all on public.reject_write_lock from public,anon,authenticated;
grant select,insert,update,delete on public.reject_write_lock to service_role;
create or replace function public.acquire_reject_write_lock(p_run uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare obtained uuid;
begin
 insert into public.reject_write_lock(id,run,expires_at) values(1,p_run,now()+interval '5 minutes')
 on conflict(id) do update set run=excluded.run,expires_at=excluded.expires_at where reject_write_lock.expires_at<now() or reject_write_lock.run=p_run
 returning run into obtained;
 return obtained=p_run;
end;
$$;
create or replace function public.release_reject_write_lock(p_run uuid) returns void
language sql security invoker set search_path=public,pg_temp as $$delete from public.reject_write_lock where id=1 and run=p_run;$$;
revoke all on function public.acquire_reject_write_lock(uuid),public.release_reject_write_lock(uuid) from public,anon,authenticated;
grant execute on function public.acquire_reject_write_lock(uuid),public.release_reject_write_lock(uuid) to service_role;
create or replace function public.inventory_unique_sku_count() returns bigint
language sql stable security invoker set search_path=public,pg_temp as $$select count(distinct upper(btrim(sku))) from public.inventory_kartu_stok where nullif(btrim(sku),'') is not null;$$;
revoke all on function public.inventory_unique_sku_count() from public,anon,authenticated;
grant execute on function public.inventory_unique_sku_count() to service_role;
notify pgrst,'reload schema';
