create table if not exists public.wms_operations (
 id uuid primary key default gen_random_uuid(), owner text not null, user_name text not null, role text not null,
 action text not null, module text not null, endpoint text not null, method text not null, page text not null default '',
 source text not null default 'WEB', editor text not null default '', reference text not null default '',
 status text not null default 'PENDING' check(status in ('PENDING','SUCCESS','FAILED','PARTIAL','UNCERTAIN','DENIED')),
 detail text not null default '', metadata jsonb not null default '{}', sync_sources text[] not null default '{}',
 created_at timestamptz not null default now(), finished_at timestamptz, duration_ms integer, http_status integer
);
create index if not exists wms_operations_recent on public.wms_operations(created_at desc,id desc);
create index if not exists wms_operations_owner_reference on public.wms_operations(owner,reference,created_at desc);
create table if not exists public.wms_work_drafts (
 owner text not null, kind text not null check(kind in ('movement','cycle-count','stock-entry','reject-entry')),
 revision bigint not null default 0, payload jsonb, updated_at timestamptz not null default now(), primary key(owner,kind),
 check(payload is null or octet_length(payload::text)<=2097152)
);
alter table public.wms_operations enable row level security;
alter table public.wms_work_drafts enable row level security;
revoke all on public.wms_operations,public.wms_work_drafts from public,anon,authenticated;
grant select,insert,update on public.wms_operations to service_role;
grant select,insert,update on public.wms_work_drafts to service_role;
create or replace function public.wms_save_work_draft(p_owner text,p_kind text,p_revision bigint,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.wms_work_drafts;
begin
 if p_owner is null or length(p_owner)<1 or length(p_owner)>200 or p_kind not in ('movement','cycle-count','stock-entry','reject-entry') or p_revision<0 then raise exception 'Invalid draft';end if;
 insert into public.wms_work_drafts(owner,kind) values(p_owner,p_kind) on conflict do nothing;
 select * into saved from public.wms_work_drafts where owner=p_owner and kind=p_kind for update;
 if saved.revision<>p_revision then return jsonb_build_object('conflict',true,'draft',to_jsonb(saved)-'owner');end if;
 update public.wms_work_drafts set payload=p_payload,revision=revision+1,updated_at=now() where owner=p_owner and kind=p_kind returning * into saved;
 return jsonb_build_object('conflict',false,'draft',to_jsonb(saved)-'owner');
end$$;
revoke all on function public.wms_save_work_draft(text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.wms_save_work_draft(text,text,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
