-- Shared application notes. All browser access goes through the authenticated
-- Pages endpoint, which derives author identity and role on the server.
create table if not exists public.sku_notes (
  id uuid primary key default gen_random_uuid(),
  sku text not null check (length(sku) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 2000),
  author_id text not null,
  author_name text not null,
  author_role text not null,
  created_at timestamptz not null default now()
);
create index if not exists sku_notes_sku_created_idx on public.sku_notes (sku, created_at desc, id desc);
alter table public.sku_notes enable row level security;
revoke all on public.sku_notes from anon, authenticated;
grant select, insert on public.sku_notes to service_role;
notify pgrst, 'reload schema';
