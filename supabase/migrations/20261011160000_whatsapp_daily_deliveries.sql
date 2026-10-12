-- Delivery deduplication only; inventory and profile tables are unchanged.
create table if not exists public.whatsapp_daily_deliveries (
  business_date date not null,
  recipient text not null,
  status text not null check (status in ('pending', 'sent', 'uncertain')),
  updated_at timestamptz not null default now(),
  primary key (business_date, recipient)
);
alter table public.whatsapp_daily_deliveries enable row level security;
revoke all on public.whatsapp_daily_deliveries from anon, authenticated;
grant select, insert, update on public.whatsapp_daily_deliveries to service_role;
notify pgrst, 'reload schema';
