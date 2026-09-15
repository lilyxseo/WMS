import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

export function locationJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=20' } });
}

export function boundedInt(value, fallback, max = 100) {
  return Math.min(max, Math.max(1, Number.parseInt(value || String(fallback), 10) || fallback));
}

export async function callLocationRpc({ request, env }, rpc, params = {}) {
  const startedAt = performance.now();
  const authStartedAt = performance.now();
  const role = await getRequestRole(request, env);
  const authMs = performance.now() - authStartedAt;
  if (!role) return { response: locationJson({ success: false, message: 'Sesi tidak valid' }, 401) };
  const queryStartedAt = performance.now();
  const config = getSecretSupabaseConfig(env);
  const response = await fetch(`${config.url}/rest/v1/rpc/${rpc}`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const payload = await response.json().catch(() => null);
  const queryMs = performance.now() - queryStartedAt;
  if (!response.ok) throw new Error(payload?.message || `Supabase RPC ${rpc} failed (${response.status})`);
  const timings = { authMs: Math.round(authMs), queryMs: Math.round(queryMs), countMs: 0, aggregateMs: Math.round(queryMs), totalMs: Math.round(performance.now() - startedAt) };
  console.info('[Locations]', { endpoint: rpc, ...timings, fullTableRead: false, aggregationInJs: false, selectStar: false, rowsTransferred: Array.isArray(payload?.rows) ? payload.rows.length : 1 });
  return { payload, timings };
}
