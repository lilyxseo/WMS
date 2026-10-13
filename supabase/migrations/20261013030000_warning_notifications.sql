create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table if not exists public.warning_notify_state(id boolean primary key default true check(id),initialized boolean not null default false,run uuid,lease timestamptz);
insert into public.warning_notify_state(id) values(true) on conflict do nothing;
create table if not exists public.warning_notify_seen(fingerprint text primary key,warning jsonb not null,first_seen timestamptz not null default now());
create table if not exists public.warning_notify_outbox(id uuid primary key default gen_random_uuid(),fingerprint text not null references public.warning_notify_seen,recipient text not null,warning jsonb not null,status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain')),created_at timestamptz not null default now(),unique(fingerprint,recipient));
alter table public.warning_notify_state enable row level security;
alter table public.warning_notify_seen enable row level security;
alter table public.warning_notify_outbox enable row level security;
revoke all on public.warning_notify_state,public.warning_notify_seen,public.warning_notify_outbox from anon,authenticated;
create or replace function public.warning_notify_lock(p_run uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update warning_notify_state set run=p_run,lease=now()+interval '4 minutes' where id and (run is null or lease<now());
 if not found then return false;end if;
 update warning_notify_outbox set status='uncertain' where status='sending';
 return true;
end $$;
create or replace function public.warning_notify_collect(p_run uuid,p_findings jsonb,p_recipients text[],p_initialize boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare initial boolean; item jsonb; added integer:=0;
begin
 select not initialized into initial from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 if p_initialize and not initial then return jsonb_build_object('baseline',false,'new',0);end if;
 for item in select value from jsonb_array_elements(p_findings) loop
  insert into warning_notify_seen(fingerprint,warning) values(item->>'fingerprint',item->'warning') on conflict do nothing;
  if found and not initial and not p_initialize then
   insert into warning_notify_outbox(fingerprint,recipient,warning) select item->>'fingerprint',r,item->'warning' from unnest(p_recipients) r on conflict do nothing;
   added:=added+1;
  end if;
 end loop;
 update warning_notify_state set initialized=true where id;
 return jsonb_build_object('baseline',initial,'new',added);
end $$;
create or replace function public.warning_notify_claim(p_run uuid) returns setof public.warning_notify_outbox language plpgsql security definer set search_path=public as $$
declare target text;
begin
 perform 1 from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 select recipient into target from warning_notify_outbox where status='pending' order by created_at,id limit 1;
 return query update warning_notify_outbox set status='sending' where id in (select id from warning_notify_outbox where status='pending' and recipient=target order by created_at,id limit 5) returning *;
end $$;
create or replace function public.warning_notify_finish(p_run uuid,p_ids uuid[],p_status text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_status not in ('sent','failed','uncertain') then raise exception 'Invalid status';end if;
 perform 1 from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 update warning_notify_outbox set status=p_status where id=any(p_ids) and status='sending';
end $$;
create or replace function public.warning_notify_unlock(p_run uuid) returns void language sql security definer set search_path=public as $$update warning_notify_state set run=null,lease=null where id and run=p_run$$;
create or replace function public.dispatch_warning_notifications() returns void language plpgsql security definer set search_path=public as $$
declare secret text; endpoint text;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='wms_warning_notify_secret' limit 1;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='wms_warning_notify_url' limit 1;
 if secret is null or endpoint is null then return;end if;
 perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','X-WMS-Warning-Secret',secret),body:='{"action":"run"}'::jsonb,timeout_milliseconds:=120000);
end $$;
revoke all on function public.warning_notify_lock(uuid),public.warning_notify_collect(uuid,jsonb,text[],boolean),public.warning_notify_claim(uuid),public.warning_notify_finish(uuid,uuid[],text),public.warning_notify_unlock(uuid),public.dispatch_warning_notifications() from public,anon,authenticated;
grant execute on function public.warning_notify_lock(uuid),public.warning_notify_collect(uuid,jsonb,text[],boolean),public.warning_notify_claim(uuid),public.warning_notify_finish(uuid,uuid[],text),public.warning_notify_unlock(uuid) to service_role;

grant all on public.warning_notify_state,public.warning_notify_seen,public.warning_notify_outbox to service_role;
