-- Keep latest positive observations separate from the complete UI baseline.
alter table public.inventory_warning_snapshot add column if not exists observed_payload jsonb;
alter table public.inventory_warning_snapshot add column if not exists observed_at timestamptz;
create or replace function public.warning_snapshot_publish(p_run uuid,p_payload jsonb) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous jsonb; ready integer; limited boolean;
begin
 select payload into previous from inventory_warning_snapshot where id and run=p_run and lease_until>now() for update;
 if not found then raise exception 'Snapshot lease unavailable';end if;
 if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_typeof(p_payload->'verification') is distinct from 'array' or p_payload->>'checkedAt' is null then raise exception 'Invalid snapshot';end if;
 select count(*) into ready from jsonb_array_elements(p_payload->'verification') item where item->>'ready'='true';
 update inventory_warning_snapshot set observed_payload=p_payload,observed_at=now() where id;
 limited:=ready<5 or jsonb_array_length(coalesce(p_payload->'unavailableSources','[]'::jsonb))>0;
 if ready=0 or (previous is not null and limited) then
  update inventory_warning_snapshot set last_error='Pemeriksaan terbaru belum lengkap; hasil sebelumnya dipertahankan.',run=null,lease_until=null where id;return false;
 end if;
 update inventory_warning_snapshot set payload=p_payload,published_at=now(),last_error=null,run=null,lease_until=null where id;return true;
end$$;

notify pgrst,'reload schema';
