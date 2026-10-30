-- Compare business identity, never sheet positions or regenerated row IDs.
create or replace function public.warning_notify_identity(w jsonb) returns text language sql immutable set search_path=public as $$
 select jsonb_build_array(w->>'category',upper(trim(coalesce(w->>'sku',''))),
 case when w->>'category' in ('NAME_MISMATCH','ACCURACY_MISMATCH','OUTBOUND_WITHOUT_INBOUND') then '' else upper(trim(coalesce(w->>'source',''))) end,
 case when w->>'category' in ('NAME_MISMATCH','ACCURACY_MISMATCH','OUTBOUND_WITHOUT_INBOUND') then '' else upper(trim(coalesce(w->>'location',''))) end,
 case when w->>'category'='INVALID_OUTBOUND_FROM' then coalesce(w->>'eventDate','')||'|'||coalesce(w->>'transactionTo','') when w->>'category' in ('MOVEMENT_NOT_REFLECTED','MOVEMENT_NO_EFFECT') then coalesce(w->>'eventDate','') else '' end,
 case when coalesce(w->>'sku','') in ('','-') then upper(trim(coalesce(w->>'namaBarang',''))) else '' end)::text
$$;

-- Notify fresh positive findings without treating missing partial data as solved.
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
   if prior.active and prior.content_signature=finding->>'content_signature' then update warning_notify_seen set last_seen=now() where fingerprint=prior.fingerprint;continue;
   elsif boot then event_kind:=case when exists(select 1 from warning_notify_outbox where fingerprint=prior.fingerprint and status in ('sent','uncertain')) then 'updated' else 'new' end;
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
create or replace function public.warning_notify_observe(p_run uuid,p_findings jsonb,p_recipients text[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare finding jsonb;prior warning_notify_seen%rowtype;current_row warning_notify_seen%rowtype;event_kind text;added integer:=0;updated integer:=0;reopened integer:=0;
begin
 perform 1 from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 if p_findings is null or jsonb_typeof(p_findings)<>'array' then raise exception 'Invalid findings';end if;
 for finding in select value from jsonb_array_elements(p_findings) loop
  select * into prior from warning_notify_seen where public.warning_notify_identity(warning)=public.warning_notify_identity(finding->'warning') order by active desc,changed_at desc,fingerprint desc limit 1 for update;
  if not found then
   insert into warning_notify_seen(fingerprint,warning,content_signature) values(finding->>'fingerprint',finding->'warning',finding->>'content_signature') returning * into current_row;event_kind:='new';
  else
   if not prior.active then event_kind:='reopened';
   elsif coalesce(prior.content_signature,'') not like 'v2:%' or prior.content_signature=finding->>'content_signature' then
    update warning_notify_seen set warning=finding->'warning',content_signature=finding->>'content_signature',last_seen=now() where fingerprint=prior.fingerprint;continue;
   else event_kind:='updated';end if;
   update warning_notify_seen set active=true,warning=finding->'warning',content_signature=finding->>'content_signature',revision=revision+1,last_seen=now(),changed_at=now(),resolved_at=null where fingerprint=prior.fingerprint returning * into current_row;
  end if;
  update warning_notify_outbox set status='cancelled' where fingerprint=current_row.fingerprint and status in ('pending','failed');
  insert into warning_notify_outbox(fingerprint,recipient,warning,event_type,revision,previous_warning)
   select current_row.fingerprint,r,current_row.warning,event_kind,current_row.revision,prior.warning from unnest(p_recipients) r on conflict do nothing;
  if event_kind='new' then added:=added+1;elsif event_kind='updated' then updated:=updated+1;else reopened:=reopened+1;end if;
 end loop;
 return jsonb_build_object('new',added,'updated',updated,'reopened',reopened,'resolved',0,'partial',true);
end$$;
create or replace function public.warning_notify_claim_observed(p_run uuid,p_findings jsonb) returns setof public.warning_notify_outbox language plpgsql security definer set search_path=public as $$
declare target text;
begin
 perform 1 from warning_notify_state where id and run=p_run and lease>now() for update;
 if not found then raise exception 'Lease unavailable';end if;
 if p_findings is null or jsonb_typeof(p_findings)<>'array' then raise exception 'Invalid findings';end if;
 select o.recipient into target from warning_notify_outbox o join warning_notify_seen s on s.fingerprint=o.fingerprint
 where s.active and o.revision=s.revision and o.event_type in ('new','updated','reopened')
 and (o.status='pending' or (o.status='failed' and o.attempts<5 and o.next_attempt_at<=now()))
 and exists(select 1 from jsonb_array_elements(p_findings) f where public.warning_notify_identity(f->'warning')=public.warning_notify_identity(o.warning))
 order by o.created_at,o.id limit 1;
 return query update warning_notify_outbox set status='sending',attempts=attempts+1 where id in (
  select o.id from warning_notify_outbox o join warning_notify_seen s on s.fingerprint=o.fingerprint
  where o.recipient=target and s.active and o.revision=s.revision and o.event_type in ('new','updated','reopened')
  and (o.status='pending' or (o.status='failed' and o.attempts<5 and o.next_attempt_at<=now()))
  and exists(select 1 from jsonb_array_elements(p_findings) f where public.warning_notify_identity(f->'warning')=public.warning_notify_identity(o.warning))
  order by o.created_at,o.id limit 5) returning *;
end$$;
revoke all on function public.warning_notify_observe(uuid,jsonb,text[]),public.warning_notify_claim_observed(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.warning_notify_observe(uuid,jsonb,text[]),public.warning_notify_claim_observed(uuid,jsonb) to service_role;
notify pgrst,'reload schema';

-- Only the server may request an immediate continuation after releasing its lease.
grant execute on function public.dispatch_warning_notifications() to service_role;
