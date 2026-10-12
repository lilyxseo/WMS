import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Run only in deployment with the existing Supabase management credential.
// Recipient numbers are repository configuration, never hard-coded in source.
export function schedulerSql(projectRef, recipients, secret) {
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  const endpoint = `https://${projectRef}.supabase.co/functions/v1/whatsapp-fonnte`;
  return `
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
do $setup$
declare existing uuid;
begin
  select id into existing from vault.secrets where name = 'wms_whatsapp_summary' limit 1;
  if existing is null then
    perform vault.create_secret(${quote(secret)}, 'wms_whatsapp_summary', 'WhatsApp daily summary scheduler authentication');
  else
    perform vault.update_secret(existing, ${quote(secret)}, 'wms_whatsapp_summary', 'WhatsApp daily summary scheduler authentication');
  end if;
end $setup$;
select cron.unschedule(jobid) from cron.job where jobname = 'wms-whatsapp-daily-summary';
select cron.schedule('wms-whatsapp-daily-summary', '45 8 * * *', $job$
  select net.http_post(
    url := ${quote(endpoint)},
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-WMS-Action', 'daily-summary',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wms_whatsapp_summary' limit 1)
    ),
    body := ${quote(JSON.stringify({ recipients }))}::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
`;
}

export async function setupDailySummary(env = process.env, fetchFn = fetch) {
  const token = env.SUPABASE_ACCESS_TOKEN, ref = env.SUPABASE_PROJECT_REF;
  const recipients = [...new Set(String(env.WHATSAPP_DAILY_SUMMARY_NUMBERS || '').split(',').map(value => value.trim()).filter(Boolean))];
  if (!recipients.length) {
    console.log('No recipient update supplied; existing Supabase Cron configuration is retained. Configure via deployment input or WHATSAPP_DAILY_SUMMARY_NUMBERS repository variable.');
    return;
  }
  if (!token || !/^[a-z0-9]+$/.test(ref || '') || recipients.length > 50 || recipients.some(number => !/^62\d{8,13}$/.test(number))) throw new Error('Invalid scheduler configuration');
  const call = async (path, body) => {
    const response = await fetchFn(`https://api.supabase.com/v1/projects/${ref}/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    // Never print query bodies, secrets or raw management responses.
    if (!response.ok) throw new Error(`Daily summary setup failed (${path}): HTTP ${response.status}`);
    return response;
  };
  const migration = await readFile(new URL('../supabase/migrations/20261011160000_whatsapp_daily_deliveries.sql', import.meta.url), 'utf8');
  await call('database/query', { query: migration });
  const secret = randomBytes(32).toString('hex');
  await call('secrets', [{ name: 'WHATSAPP_SUMMARY_SCHEDULER_SECRET', value: secret }]);
  await call('database/query', { query: schedulerSql(ref, recipients, secret) });
  console.log(`Daily summary configured at 15:45 Asia/Jakarta for ${recipients.length} recipient(s).`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) await setupDailySummary();
