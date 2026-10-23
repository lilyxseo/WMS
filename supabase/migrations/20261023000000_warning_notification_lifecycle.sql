alter table public.warning_notify_state add column if not exists lifecycle_initialized boolean not null default false;
alter table public.warning_notify_seen add column if not exists active boolean not null default true;
alter table public.warning_notify_seen add column if not exists revision integer not null default 1;
alter table public.warning_notify_seen add column if not exists content_signature text;
alter table public.warning_notify_seen add column if not exists last_seen timestamptz not null default now();
alter table public.warning_notify_seen add column if not exists changed_at timestamptz not null default now();
alter table public.warning_notify_seen add column if not exists resolved_at timestamptz;
alter table public.warning_notify_outbox add column if not exists event_type text not null default 'new' check(event_type in ('new','updated','resolved','reopened'));
alter table public.warning_notify_outbox add column if not exists revision integer not null default 0;
alter table public.warning_notify_outbox add column if not exists previous_warning jsonb;
alter table public.warning_notify_outbox add column if not exists attempts integer not null default 0;
alter table public.warning_notify_outbox add column if not exists next_attempt_at timestamptz not null default now();
alter table public.warning_notify_outbox drop constraint if exists warning_notify_outbox_fingerprint_recipient_key;
alter table public.warning_notify_outbox drop constraint if exists warning_notify_outbox_status_check;
alter table public.warning_notify_outbox add constraint warning_notify_outbox_status_check check(status in ('pending','sending','sent','failed','uncertain','cancelled'));
create unique index if not exists warning_notify_event_key on public.warning_notify_outbox(fingerprint,recipient,revision,event_type);
create index if not exists warning_notify_delivery_idx on public.warning_notify_outbox(status,next_attempt_at,created_at);
revoke all on public.warning_notify_state,public.warning_notify_seen,public.warning_notify_outbox from public,anon,authenticated;
create or replace function public.warning_notify_collect(p_run uuid,p_findings jsonb,p_recipients text[],p_initialize boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare boot boolean; finding jsonb; prior warning_notify_seen%rowtype; current_row warning_notify_seen%rowtype; event_kind text; added integer:=0; updated integer:=0; resolved integer:=0; reopened integer:=0;
begin
 select not lifecycle_initialized into boot from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 if jsonb_typeof(p_findings)<>'array' or p_findings is null then raise exception 'Invalid findings';end if;
 -- Redeploys/checks must not erase tracking or swallow a notification.
 if p_initialize then return jsonb_build_object('baseline',boot,'new',0,'updated',0,'resolved',0,'reopened',0);end if;
 if boot then
  -- Historic absences predate lifecycle tracking; never call them newly solved.
  update warning_notify_seen set active=false,resolved_at=now();
  update warning_notify_outbox set status='cancelled' where status in ('pending','failed');
 end if;
 for finding in select value from jsonb_array_elements(p_findings) loop
  select * into prior from warning_notify_seen where fingerprint=finding->>'fingerprint' for update;
  if not found then
   insert into warning_notify_seen(fingerprint,warning,content_signature) values(finding->>'fingerprint',finding->'warning',finding->>'content_signature') returning * into current_row;
   event_kind:='new';
  else
   if boot then event_kind:=case when exists(select 1 from warning_notify_outbox where fingerprint=prior.fingerprint and status in ('sent','uncertain')) then 'updated' else 'new' end;
   elsif not prior.active then event_kind:='reopened';
   elsif prior.content_signature is distinct from finding->>'content_signature' then event_kind:='updated';
   else update warning_notify_seen set last_seen=now() where fingerprint=prior.fingerprint;continue;end if;
   update warning_notify_seen set active=true,warning=finding->'warning',content_signature=finding->>'content_signature',revision=revision+1,last_seen=now(),changed_at=now(),resolved_at=null where fingerprint=prior.fingerprint returning * into current_row;
  end if;
  update warning_notify_outbox set status='cancelled' where fingerprint=current_row.fingerprint and status in ('pending','failed');
  insert into warning_notify_outbox(fingerprint,recipient,warning,event_type,revision,previous_warning)
   select current_row.fingerprint,r,current_row.warning,event_kind,current_row.revision,prior.warning from unnest(p_recipients) r on conflict do nothing;
  if event_kind='new' then added:=added+1;elsif event_kind='updated' then updated:=updated+1;else reopened:=reopened+1;end if;
 end loop;
 for prior in select * from warning_notify_seen s where s.active and not exists(select 1 from jsonb_array_elements(p_findings) f where f->>'fingerprint'=s.fingerprint) for update loop
  update warning_notify_seen set active=false,revision=revision+1,changed_at=now(),resolved_at=now() where fingerprint=prior.fingerprint returning * into current_row;
  update warning_notify_outbox set status='cancelled' where fingerprint=prior.fingerprint and status in ('pending','failed');
  insert into warning_notify_outbox(fingerprint,recipient,warning,event_type,revision,previous_warning)
   select current_row.fingerprint,r,current_row.warning,'resolved',current_row.revision,current_row.warning from unnest(p_recipients) r on conflict do nothing;
  resolved:=resolved+1;
 end loop;
 update warning_notify_state set lifecycle_initialized=true,initialized=true where id;
 return jsonb_build_object('baseline',boot,'new',added,'updated',updated,'resolved',resolved,'reopened',reopened);
end$$;
create or replace function public.warning_notify_claim(p_run uuid) returns setof public.warning_notify_outbox language plpgsql security definer set search_path=public as $$
declare target text;
begin
 perform 1 from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 select recipient into target from warning_notify_outbox where status='pending' or (status='failed' and attempts<5 and next_attempt_at<=now()) order by created_at,id limit 1;
 return query update warning_notify_outbox set status='sending',attempts=attempts+1 where id in (select id from warning_notify_outbox where recipient=target and (status='pending' or (status='failed' and attempts<5 and next_attempt_at<=now())) order by created_at,id limit 5) returning *;
end$$;
create or replace function public.warning_notify_finish(p_run uuid,p_ids uuid[],p_status text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_status not in ('sent','failed','uncertain') then raise exception 'Invalid status';end if;
 perform 1 from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 update warning_notify_outbox set status=p_status,next_attempt_at=now()+interval '5 minutes' where id=any(p_ids) and status='sending';
end$$;
revoke all on function public.warning_notify_collect(uuid,jsonb,text[],boolean),public.warning_notify_claim(uuid),public.warning_notify_finish(uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.warning_notify_collect(uuid,jsonb,text[],boolean),public.warning_notify_claim(uuid),public.warning_notify_finish(uuid,uuid[],text) to service_role;
notify pgrst,'reload schema';
