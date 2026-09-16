import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

export function locationJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=20', ...extraHeaders } });
}

export function boundedInt(value, fallback, max = 100) {
  return Math.min(max, Math.max(1, Number.parseInt(value || String(fallback), 10) || fallback));
}

export class LocationApiError extends Error {
  constructor(message, { code = 'LOCATION_UPSTREAM_ERROR', status = 502, details = '', hint = '', rpc = '' } = {}) {
    super(message);
    this.name = 'LocationApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.hint = hint;
    this.rpc = rpc;
  }
}

export function locationErrorResponse(error, endpoint) {
  const missingRpc = error?.code === 'PGRST202' || error?.code === '42883';
  const missingConfig = /SUPABASE_(?:URL|SECRET_KEY) (?:is required|must start with)/.test(String(error?.message || ''));
  const code = missingRpc ? 'LOCATION_RPC_MISSING' : missingConfig ? 'LOCATION_CONFIG_ERROR' : (error?.code || 'LOCATION_UPSTREAM_ERROR');
  const status = missingRpc ? 503 : missingConfig ? 500 : (error?.status || 502);
  console.error('[LocationAPI] failure', { endpoint, code: error?.code || code, status, message: error?.message, details: error?.details, hint: error?.hint, stack: error?.stack });
  const message = endpoint === 'location_summary' ? 'Gagal memuat ringkasan lokasi'
    : endpoint === 'location_empty' ? 'Gagal memuat lokasi kosong'
      : endpoint === 'location_list' ? 'Gagal memuat daftar lokasi' : 'Gagal memuat detail lokasi';
  return locationJson({ success: false, message, code }, status);
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
  const dbMs = performance.now() - queryStartedAt;
  if (!response.ok) throw new LocationApiError(payload?.message || `Supabase RPC ${rpc} failed (${response.status})`, {
    code: payload?.code,
    status: response.status >= 400 && response.status < 500 ? response.status : 502,
    details: payload?.details,
    hint: payload?.hint,
    rpc,
  });
  const returnedRows = Array.isArray(payload?.rows) ? payload.rows.length : 1;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  const timings = { authMs: Math.round(authMs), dbMs: Math.round(dbMs), returnedRows, totalMs: Math.round(performance.now() - startedAt) };
  console.info(`[LocationAPI] endpoint=${rpc} authMs=${timings.authMs} dbMs=${timings.dbMs} returnedRows=${returnedRows} payloadBytes=${payloadBytes} totalMs=${timings.totalMs}`);
  return { payload, timings, headers: { 'Server-Timing': `auth;dur=${timings.authMs}, db;dur=${timings.dbMs}, total;dur=${timings.totalMs}`, 'X-Location-Rows': String(returnedRows) } };
}
