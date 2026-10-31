-- Preserve existing history; add the missing history store on older installs.
create table if not exists public.activity_logs(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),user_id text,user_name text,role text,action text not null,module text not null,detail text,reference text,status text not null default 'SUCCESS',metadata jsonb not null default '{}');
alter table public.activity_logs add column if not exists id uuid default gen_random_uuid();
alter table public.activity_logs add column if not exists created_at timestamptz default now();
alter table public.activity_logs add column if not exists action text;
alter table public.activity_logs add column if not exists module text;
alter table public.activity_logs add column if not exists status text default 'SUCCESS';
alter table public.activity_logs add column if not exists user_id text;
alter table public.activity_logs add column if not exists user_name text;
alter table public.activity_logs add column if not exists role text;
alter table public.activity_logs add column if not exists detail text;
alter table public.activity_logs add column if not exists reference text;
alter table public.activity_logs add column if not exists metadata jsonb default '{}';
alter table public.activity_logs enable row level security;
revoke all on public.activity_logs from anon,authenticated;
grant all on public.activity_logs to service_role;
create index if not exists activity_logs_created_feed_idx on public.activity_logs(created_at desc,id desc);
create index if not exists activity_logs_reference_feed_idx on public.activity_logs(reference);
create or replace view public.wms_activity_feed with (security_invoker=true) as
 select 'activity:'||a.id::text id,a.created_at::timestamptz created_at,a.user_id::text user_id,a.user_name::text user_name,a.role::text role,a.action::text action,a.module::text module,a.detail::text detail,a.reference::text reference,a.status::text status,coalesce(a.metadata::jsonb,'{}'::jsonb)||jsonb_build_object('verified',false,'feed','history') metadata from public.activity_logs a
 union all
 select 'operation:'||o.id::text,o.created_at,o.owner,o.user_name,o.role,o.action,o.module,o.detail,o.id::text,o.status,
 coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('verified',true,'feed','operations','page',o.page,'source',o.source,'editor',o.editor,'endpoint',o.endpoint,'httpStatus',o.http_status,'durationMs',o.duration_ms,'requestReference',o.reference,'syncState',case when o.status not in ('SUCCESS','PARTIAL') then 'NOT_WRITTEN' when cardinality(o.sync_sources)=0 then 'DIRECT' else 'UNKNOWN' end,'details',jsonb_build_object('sheet',o.metadata->'sheet','rows',o.metadata->'rows','fields',o.metadata->'fields','changes',coalesce(o.metadata->'changes','[]'::jsonb),'captureComplete',coalesce(o.metadata->'captureComplete','false'::jsonb))) from public.wms_operations o;
revoke all on public.wms_activity_feed from public,anon,authenticated;
grant select on public.wms_activity_feed to service_role;
notify pgrst,'reload schema';
