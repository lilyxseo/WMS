-- Request receipts only: no stock or ledger data is modified by this migration.
create table if not exists public.stock_entry_batches (
 id uuid primary key,
 owner text not null,
 author_name text not null,
 author_role text not null,
 payload_hash text not null,
 run uuid not null,
 status text not null check(status in ('preparing','writing','saved','failed','uncertain')),
 result jsonb,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
alter table public.stock_entry_batches enable row level security;
revoke all on public.stock_entry_batches from anon, authenticated;
grant select, insert, update on public.stock_entry_batches to service_role;

notify pgrst, 'reload schema';
