-- Compare business identity, never sheet positions or regenerated row IDs.
create or replace function public.warning_notify_identity(w jsonb) returns text language sql immutable set search_path=public as $$
 select jsonb_build_array(w->>'category',upper(trim(coalesce(w->>'sku',''))),
 case when w->>'category' in ('NAME_MISMATCH','ACCURACY_MISMATCH','OUTBOUND_WITHOUT_INBOUND') then '' else upper(trim(coalesce(w->>'source',''))) end,
 case when w->>'category' in ('NAME_MISMATCH','ACCURACY_MISMATCH','OUTBOUND_WITHOUT_INBOUND') then '' else upper(trim(coalesce(w->>'location',''))) end,
 case when w->>'category' in ('MOVEMENT_NOT_REFLECTED','MOVEMENT_NO_EFFECT') then coalesce(w->>'eventDate','') else '' end,
 case when coalesce(w->>'sku','') in ('','-') then upper(trim(coalesce(w->>'namaBarang',''))) else '' end)::text
$$;
-- Keep old delivery history; silently retire duplicate tracking identities.
update public.warning_notify_seen s set active=false
where s.active and exists(select 1 from public.warning_notify_seen newer
 where newer.active and public.warning_notify_identity(newer.warning)=public.warning_notify_identity(s.warning)
 and newer.active and (newer.changed_at,newer.fingerprint)>(s.changed_at,s.fingerprint));
create or replace function public.warning_notify_collect(p_run uuid,p_findings jsonb,p_recipients text[],p_initialize boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare boot boolean; finding jsonb; prior warning_notify_seen%rowtype; current_row warning_notify_seen%rowtype; event_kind text; added integer:=0; updated integer:=0; resolved integer:=0; reopened integer:=0;
begin
 select not lifecycle_initialized into boot from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 if jsonb_typeof(p_findings)<>'array' or p_findings is null then raise exception 'Invalid findings';end if;
 -- Redeploys/checks must not erase tracking or swallow a notification.
 if p_initialize then return jsonb_build_object('baseline',boot,'new',0,'updated',0,'resolved',0,'reopened',0);end if;
 -- Establish a baseline without advertising historic absences as newly solved.
 for finding in select value from jsonb_array_elements(p_findings) loop
  select * into prior from warning_notify_seen where public.warning_notify_identity(warning)=public.warning_notify_identity(finding->'warning') order by active desc,changed_at desc,fingerprint desc limit 1 for update;
  if not found then
   insert into warning_notify_seen(fingerprint,warning,content_signature) values(finding->>'fingerprint',finding->'warning',finding->>'content_signature') returning * into current_row;
   event_kind:='new';
  else
   if boot then event_kind:=case when exists(select 1 from warning_notify_outbox where fingerprint=prior.fingerprint and status in ('sent','uncertain')) then 'updated' else 'new' end;
   elsif not prior.active then event_kind:='reopened';
   elsif coalesce(prior.content_signature,'') not like 'v2:%' then
    update warning_notify_seen set warning=finding->'warning',content_signature=finding->>'content_signature',last_seen=now() where fingerprint=prior.fingerprint;continue;
   elsif prior.content_signature is distinct from finding->>'content_signature' then event_kind:='updated';
   else update warning_notify_seen set last_seen=now() where fingerprint=prior.fingerprint;continue;end if;
   update warning_notify_seen set active=true,warning=finding->'warning',content_signature=finding->>'content_signature',revision=revision+1,last_seen=now(),changed_at=now(),resolved_at=null where fingerprint=prior.fingerprint returning * into current_row;
  end if;
  update warning_notify_outbox set status='cancelled' where fingerprint=current_row.fingerprint and status in ('pending','failed');
  insert into warning_notify_outbox(fingerprint,recipient,warning,event_type,revision,previous_warning)
   select current_row.fingerprint,r,current_row.warning,event_kind,current_row.revision,prior.warning from unnest(p_recipients) r on conflict do nothing;
  if event_kind='new' then added:=added+1;elsif event_kind='updated' then updated:=updated+1;else reopened:=reopened+1;end if;
 end loop;
 for prior in select * from warning_notify_seen s where s.active and not exists(select 1 from jsonb_array_elements(p_findings) f where public.warning_notify_identity(f->'warning')=public.warning_notify_identity(s.warning)) for update loop
  update warning_notify_seen set active=false,revision=revision+1,changed_at=now(),resolved_at=now() where fingerprint=prior.fingerprint returning * into current_row;
  update warning_notify_outbox set status='cancelled' where fingerprint=prior.fingerprint and status in ('pending','failed');
  if boot or prior.content_signature is null or prior.last_seen<now()-interval '15 minutes' then continue;end if;
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
 update warning_notify_outbox o set status='cancelled' from warning_notify_seen s where s.fingerprint=o.fingerprint and o.event_type='resolved' and o.status in ('pending','failed') and (s.content_signature is null or o.created_at<now()-interval '15 minutes');
 -- Discard superseded events and repeated resolutions before touching Fonnte.
 update warning_notify_outbox o set status='cancelled' from warning_notify_seen s
 where o.fingerprint=s.fingerprint and o.status in ('pending','failed') and
 (o.revision<>s.revision or (o.event_type='resolved')=s.active
 or exists(select 1 from warning_notify_seen newer where public.warning_notify_identity(newer.warning)=public.warning_notify_identity(s.warning) and newer.active and (newer.changed_at,newer.fingerprint)>(s.changed_at,s.fingerprint))
 or (o.event_type='resolved' and not exists(
  select 1 from warning_notify_outbox delivered
  where delivered.recipient=o.recipient and public.warning_notify_identity(delivered.warning)=public.warning_notify_identity(o.warning)
  and delivered.event_type in ('new','updated','reopened') and delivered.status in ('sent','uncertain')
  and (delivered.created_at<o.created_at or (delivered.fingerprint=o.fingerprint and delivered.revision<o.revision))
  and not exists(select 1 from warning_notify_outbox solved where solved.recipient=o.recipient
   and public.warning_notify_identity(solved.warning)=public.warning_notify_identity(o.warning)
   and solved.event_type='resolved' and solved.status in ('sent','uncertain') and (solved.created_at>delivered.created_at or (solved.fingerprint=delivered.fingerprint and solved.revision>=delivered.revision))))));
 select recipient into target from warning_notify_outbox where status='pending' or (status='failed' and attempts<5 and next_attempt_at<=now()) order by case event_type when 'resolved' then 0 when 'reopened' then 1 when 'updated' then 2 else 3 end,created_at,id limit 1;
 return query update warning_notify_outbox set status='sending',attempts=attempts+1 where id in (select id from warning_notify_outbox where recipient=target and (status='pending' or (status='failed' and attempts<5 and next_attempt_at<=now())) order by case event_type when 'resolved' then 0 when 'reopened' then 1 when 'updated' then 2 else 3 end,created_at,id limit 5) returning *;
end$$;

revoke all on function public.warning_notify_collect(uuid,jsonb,text[],boolean),public.warning_notify_claim(uuid) from public,anon,authenticated;
grant execute on function public.warning_notify_collect(uuid,jsonb,text[],boolean),public.warning_notify_claim(uuid) to service_role;
notify pgrst,'reload schema';

revoke all on function public.warning_notify_identity(jsonb) from public,anon,authenticated;
grant execute on function public.warning_notify_identity(jsonb) to service_role;
