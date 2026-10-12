-- Only bot search context is retained; inventory tables are not modified.
create table if not exists public.whatsapp_search_sessions (
  sender text primary key,
  search jsonb not null,
  expires_at timestamptz not null
);
alter table public.whatsapp_search_sessions enable row level security;
revoke all on public.whatsapp_search_sessions from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_search_sessions to service_role;
notify pgrst, 'reload schema';
