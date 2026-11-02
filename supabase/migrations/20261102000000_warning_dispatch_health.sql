create table if not exists public.warning_notification_dispatches(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),request_id bigint,code text not null);
alter table public.warning_notification_dispatches enable row level security;
revoke all on public.warning_notification_dispatches from public,anon,authenticated;
grant all on public.warning_notification_dispatches to service_role;
create index if not exists warning_notification_dispatch_recent on public.warning_notification_dispatches(created_at desc);
create or replace function public.dispatch_warning_notifications() returns void language plpgsql security definer set search_path=public as $$
declare secret text;endpoint text;request bigint;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='wms_warning_notify_secret' limit 1;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='wms_warning_notify_url' limit 1;
 delete from warning_notification_dispatches where created_at<now()-interval '7 days';
 if secret is null or endpoint is null then insert into warning_notification_dispatches(code) values('CONFIG_MISSING');return;end if;
 request:=net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','X-WMS-Warning-Secret',secret),body:='{"action":"run"}'::jsonb,timeout_milliseconds:=120000);
 insert into warning_notification_dispatches(request_id,code) values(request,'DISPATCHED');
end$$;
revoke all on function public.dispatch_warning_notifications() from public,anon,authenticated;
grant execute on function public.dispatch_warning_notifications() to service_role;
create or replace function public.warning_notification_health() returns jsonb language plpgsql security definer set search_path=public as $$
declare dispatch warning_notification_dispatches%rowtype;http record;result jsonb:='{}';worker jsonb:='{}';jobs jsonb;
begin
 select * into dispatch from warning_notification_dispatches order by created_at desc limit 1;
 if dispatch.request_id is not null then
  select status_code,timed_out,content into http from net._http_response where id=dispatch.request_id;
  if found then
   begin worker:=http.content::jsonb;exception when others then worker:='{}';end;
   result:=jsonb_build_object('httpStatus',http.status_code,'timedOut',http.timed_out,'status',left(coalesce(worker->>'status',worker->>'code','UNKNOWN'),80),'stage',left(worker->>'stage',80),'accepted',worker->'accepted','failed',worker->'failed','uncertain',worker->'uncertain');
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',jobname,'active',active,'schedule',schedule)),'[]') into jobs from cron.job where jobname in ('wms-warning-snapshot','wms-warning-notifications');
 return jsonb_build_object('recipients',jsonb_array_length(public.notification_allowed_numbers('warning')),'lastDispatch',dispatch.created_at,'dispatchCode',dispatch.code,'worker',result,'jobs',jobs,
 'snapshot',(select jsonb_build_object('publishedAt',published_at,'observedAt',observed_at,'lastAttemptAt',last_attempt_at,'hasError',last_error is not null) from inventory_warning_snapshot where id),
 'queue',(select coalesce(jsonb_object_agg(status,amount),'{}') from(select status,count(*) amount from warning_notify_outbox group by status) totals),
 'exhausted',(select count(*) from warning_notify_outbox where status='failed' and attempts>=5));
end$$;
revoke all on function public.warning_notification_health() from public,anon,authenticated;
grant execute on function public.warning_notification_health() to service_role;
notify pgrst,'reload schema';
