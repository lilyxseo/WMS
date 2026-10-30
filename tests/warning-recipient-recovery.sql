-- Run only inside the deployment validation transaction, which is rolled back.
do $$declare owner uuid:=gen_random_uuid();finding jsonb;amount integer;target text;begin
 delete from public.warning_notify_outbox;delete from public.warning_notify_seen;
 update public.warning_notify_state set run=null,lease=null where id;
 if not public.warning_notify_lock(owner) then raise exception 'Recovery lease';end if;
 target:=coalesce(public.notification_allowed_numbers('warning')->>0,'620000000001');
 -- Permission checks use configured recipients; all synthetic events roll back.
 finding:='[{"warning":{"category":"NEGATIVE_STOCK","source":"Kartu Stok","sku":"RECOVERY","location":"A1"}}]'::jsonb;
 insert into public.warning_notify_seen(fingerprint,warning,active,content_signature) values('missing',finding->0->'warning',true,'v2:same');
 insert into public.warning_notify_seen(fingerprint,warning,active,content_signature) values('alias',finding->0->'warning',true,'v2:same');
 -- No implicit recipients: zero configured recipients must remain zero deliveries.
 amount:=public.warning_notify_enqueue_missing(owner,finding,array[]::text[]);if amount<>0 then raise exception 'Empty recipients delivered';end if;
 amount:=public.warning_notify_enqueue_missing(owner,finding,array[target]);
 if public.notification_allowed_numbers('warning') ? target then
  if amount<>1 then raise exception 'Never delivered active warning not recovered';end if;
  amount:=public.warning_notify_enqueue_missing(owner,finding,array[target]);if amount<>0 then raise exception 'Recovery duplicated queue';end if;
  update public.warning_notify_outbox set status='cancelled' where fingerprint='missing';
  amount:=public.warning_notify_enqueue_missing(owner,finding,array[target]);if amount<>1 then raise exception 'Revoked and reenabled recipient not recovered';end if;
  update public.warning_notify_outbox set status='sent' where fingerprint='missing';
  amount:=public.warning_notify_enqueue_missing(owner,finding,array[target]);if amount<>0 then raise exception 'Sent message replayed';end if;
  update public.warning_notify_outbox set status='uncertain' where fingerprint='missing';
  amount:=public.warning_notify_enqueue_missing(owner,finding,array[target]);if amount<>0 then raise exception 'Uncertain message replayed';end if;
  delete from public.warning_notify_outbox;
  amount:=public.warning_notify_enqueue_missing(owner,'[]',array[target]);if amount<>0 then raise exception 'Unobserved finding recovered';end if;
  update public.warning_notify_seen set active=false where fingerprint in ('missing','alias');
  amount:=public.warning_notify_enqueue_missing(owner,finding,array[target]);if amount<>0 then raise exception 'Solved finding recovered';end if;
 else
  if amount<>0 then raise exception 'Unauthorized recipient delivered';end if;
 end if;
 amount:=public.warning_notify_enqueue_missing(owner,finding,array['invalid']);if amount<>0 then raise exception 'Unauthorized recipient recovered';end if;
 perform public.warning_notify_unlock(owner);
end$$;
