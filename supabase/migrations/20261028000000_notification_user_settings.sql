create table if not exists public.notification_user_settings(
 user_id text primary key, warning_enabled boolean not null default false,
 bot_enabled boolean not null default false, updated_by text, updated_at timestamptz not null default now()
);
alter table public.notification_user_settings enable row level security;
revoke all on public.notification_user_settings from anon,authenticated;
grant all on public.notification_user_settings to service_role;
create or replace function public.notification_allowed_numbers(p_kind text) returns jsonb
language sql stable security definer set search_path=public as $$
 with users_phone as (
 select u.id::text as id,regexp_replace(coalesce(case when to_jsonb(u) ? 'phone' then to_jsonb(u)->>'phone' when to_jsonb(u) ? 'phone_number' then to_jsonb(u)->>'phone_number' when to_jsonb(u) ? 'whatsapp' then to_jsonb(u)->>'whatsapp' when to_jsonb(u) ? 'whatsapp_number' then to_jsonb(u)->>'whatsapp_number' when to_jsonb(u) ? 'nomor_hp' then to_jsonb(u)->>'nomor_hp' when to_jsonb(u) ? 'no_hp' then to_jsonb(u)->>'no_hp' when to_jsonb(u) ? 'nomor_telepon' then to_jsonb(u)->>'nomor_telepon' when to_jsonb(u) ? 'nomor_whatsapp' then to_jsonb(u)->>'nomor_whatsapp' when to_jsonb(u) ? 'phoneNumber' then to_jsonb(u)->>'phoneNumber' else '' end,''),'[^0-9]','','g') as raw from public.users u
 ), normalized as (select id,case when raw like '0%' then '62'||substr(raw,2) when raw like '8%' then '62'||raw else raw end as phone from users_phone)
 select coalesce(jsonb_agg(distinct phone),'[]'::jsonb) from normalized n join public.notification_user_settings s on s.user_id=n.id
 where phone ~ '^62[0-9]{8,13}$' and case p_kind when 'warning' then s.warning_enabled when 'bot' then s.bot_enabled else false end;
$$;
revoke all on function public.notification_allowed_numbers(text) from public,anon,authenticated;
grant execute on function public.notification_allowed_numbers(text) to service_role;
create or replace function public.notification_cancel_revoked() returns void
language sql security definer set search_path=public as $$
 update public.warning_notify_outbox set status='cancelled' where status in ('pending','failed','sending') and not (public.notification_allowed_numbers('warning') ? recipient);
$$;
revoke all on function public.notification_cancel_revoked() from public,anon,authenticated;
grant execute on function public.notification_cancel_revoked() to service_role;
