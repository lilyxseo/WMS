import { businessDate, getDailySummary, formatDailySummary } from './daily-summary.js';
import { normalizePhone } from './profiles.js';

const json = (body,status = 200) => Response.json(body,{status});
export async function handleScheduledSummary(request, env, config, fetchFn, now = new Date()) {
  const expected = String(env.WHATSAPP_SUMMARY_SCHEDULER_SECRET || '');
  if (!expected || request.headers.get('Authorization') !== `Bearer ${expected}`) return json({ success:false },401);
  let body;
  try { body = await request.json(); } catch { return json({success:false},400); }
  const recipients = [...new Set((Array.isArray(body?.recipients) ? body.recipients : []).map(normalizePhone))];
  if (!recipients.length || recipients.length > 50 || recipients.some(number => !/^62\d{8,13}$/.test(number))) return json({success:false,message:'Invalid recipients'},400);
  if (!env.FONNTE_TOKEN) return json({success:false},503);
  const timeZone = env.BUSINESS_TIME_ZONE || 'Asia/Jakarta', date = businessDate(now,timeZone);
  let message;
  try { message = formatDailySummary(await getDailySummary(config,date,fetchFn),now,timeZone); }
  catch { return json({success:false,message:'Summary read failed; no messages sent'},503); }
  const headers = { apikey:config.key, Authorization:`Bearer ${config.key}`, 'Content-Type':'application/json' };
  let sent = 0, skipped = 0, failed = 0;
  for (const recipient of recipients) {
    // A durable per-day recipient claim prevents concurrent cron invocations from sending twice.
    // Uncertain Fonnte responses retain the claim; never automatically retry a possible delivery.
    let response;
    try {
      response = await fetchFn(`${config.url}/rest/v1/whatsapp_daily_deliveries?on_conflict=business_date,recipient`, {
        method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},
        body:JSON.stringify({business_date:date,recipient,status:'pending'}),signal:AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Summary claim failed');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid claim response');
      if (!rows.length) { skipped++; continue; }
    } catch { failed++; continue; }
    let status = 'uncertain';
    try {
      const delivery = await fetchFn('https://api.fonnte.com/send', { method:'POST',headers:{Authorization:env.FONNTE_TOKEN},body:new URLSearchParams({target:recipient,message,countryCode:'62'}),signal:AbortSignal.timeout(10000) });
      const result = await delivery.json();
      if (!delivery.ok || result.status !== true) throw new Error('Summary delivery unconfirmed');
      status = 'sent'; sent++;
    } catch { failed++; }
    try {
      await fetchFn(`${config.url}/rest/v1/whatsapp_daily_deliveries?business_date=eq.${date}&recipient=eq.${recipient}`, {method:'PATCH',headers,body:JSON.stringify({status,updated_at:now.toISOString()}),signal:AbortSignal.timeout(10000)});
    } catch { /* The pending claim still prevents duplicates after a confirmed send. */ }
  }
  return json({success:failed === 0,date,sent,skipped,failed},failed ? 502 : 200);
}
