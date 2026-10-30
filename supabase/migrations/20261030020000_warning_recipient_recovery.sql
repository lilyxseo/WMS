-- Recover active findings that have never reached an enabled recipient.
-- Never replay delivered/uncertain messages or resolve findings from partial data.
create or replace function public.warning_notify_enqueue_missing(p_run uuid,p_findings jsonb,p_recipients text[]) returns integer
language plpgsql security definer set search_path=public as $$
declare amount integer; revived integer;
begin
 perform 1 from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 if p_findings is null or jsonb_typeof(p_findings)<>'array' then raise exception 'Invalid findings';end if;
 -- A recipient may have been disabled before a previous attempt was dispatched.
 update warning_notify_outbox o set status='pending',attempts=0,next_attempt_at=now()
 from warning_notify_seen s
 where o.fingerprint=s.fingerprint and s.active and o.revision=s.revision
 and o.event_type in ('new','updated','reopened') and o.status='cancelled'
 and s.fingerprint=(select latest.fingerprint from warning_notify_seen latest where latest.active and public.warning_notify_identity(latest.warning)=public.warning_notify_identity(s.warning) order by latest.changed_at desc,latest.fingerprint desc limit 1)
 and o.recipient=any(p_recipients) and public.notification_allowed_numbers('warning') ? o.recipient
 and exists(select 1 from jsonb_array_elements(p_findings) f where public.warning_notify_identity(f->'warning')=public.warning_notify_identity(s.warning))
 and not exists(select 1 from warning_notify_outbox old where old.recipient=o.recipient and old.status in ('sent','uncertain','pending','failed','sending') and public.warning_notify_identity(old.warning)=public.warning_notify_identity(s.warning));
 get diagnostics revived=row_count;
 insert into warning_notify_outbox(fingerprint,recipient,warning,event_type,revision)
 select s.fingerprint,r,s.warning,'new',s.revision from warning_notify_seen s cross join unnest(p_recipients) r
 where s.active and public.notification_allowed_numbers('warning') ? r
 and s.fingerprint=(select latest.fingerprint from warning_notify_seen latest where latest.active and public.warning_notify_identity(latest.warning)=public.warning_notify_identity(s.warning) order by latest.changed_at desc,latest.fingerprint desc limit 1)
 and exists(select 1 from jsonb_array_elements(p_findings) f where public.warning_notify_identity(f->'warning')=public.warning_notify_identity(s.warning))
 and not exists(select 1 from warning_notify_outbox old where old.recipient=r and old.status in ('sent','uncertain','pending','failed','sending') and public.warning_notify_identity(old.warning)=public.warning_notify_identity(s.warning))
 on conflict do nothing;
 get diagnostics amount=row_count;
 return amount+revived;
end$$;
revoke all on function public.warning_notify_enqueue_missing(uuid,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.warning_notify_enqueue_missing(uuid,jsonb,text[]) to service_role;
notify pgrst,'reload schema';
