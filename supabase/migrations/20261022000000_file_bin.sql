create table if not exists public.wms_files(
 id uuid primary key,object_path text unique not null,
 name text not null check(length(name) between 1 and 255),
 size_bytes bigint not null check(size_bytes between 1 and 20971520),
 content_type text not null default 'application/octet-stream',
 owner_id text not null,owner_name text not null,owner_role text not null,
 created_at timestamptz not null default now()
);
create index if not exists wms_files_created_idx on public.wms_files(created_at desc,id);
alter table public.wms_files enable row level security;
revoke all on public.wms_files from public,anon,authenticated;
grant select,insert,delete on public.wms_files to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('wms-file-bin','wms-file-bin',false,20971520)
on conflict(id) do update set public=false,file_size_limit=20971520;
-- Only the application server may access this bucket directly. Other buckets
-- retain their existing policies; signed downloads still use Storage tokens.
do $$begin
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='wms_file_bin_server_only') then
  create policy wms_file_bin_server_only on storage.objects as restrictive for all to anon,authenticated
   using(bucket_id <> 'wms-file-bin') with check(bucket_id <> 'wms-file-bin');
 end if;
end$$;
notify pgrst,'reload schema';
