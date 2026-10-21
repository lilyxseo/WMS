create table if not exists public.archive_spreadsheets(
 spreadsheet_id text primary key check(spreadsheet_id ~ '^[A-Za-z0-9_-]{20,120}$'),
 name text not null check(length(btrim(name)) between 1 and 120),
 created_by text not null,created_at timestamptz not null default now()
);
alter table public.archive_spreadsheets enable row level security;
revoke all on public.archive_spreadsheets from public,anon,authenticated;
grant select,insert,update,delete on public.archive_spreadsheets to service_role;
notify pgrst,'reload schema';
