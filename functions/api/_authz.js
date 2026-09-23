import { getPublishableSupabaseConfig, getSecretSupabaseConfig } from './_supabase-config.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

const READ_ONLY_REASON = 'READ_ONLY_ROLE';

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[0];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch (_err) {
    return null;
  }
}

function isTruthy(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return value === true || normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function getBearerToken(request) {
  const auth = String(request.headers.get('authorization') || '');
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

function toBase64Url(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function isDeveloperRequest(request, env) {
  const token = getBearerToken(request);
  const payload = decodeJwtPayload(token);
  const [encodedPayload, suppliedSignature] = token.split('.');
  const sessionSecret = String(env?.DEV_SESSION_SECRET || '');
  if (payload?.isDeveloper === true && payload?.sub === 'developer' && Number(payload.exp || 0) > Math.floor(Date.now() / 1000) && encodedPayload && suppliedSignature && sessionSecret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(sessionSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
    const expectedSignature = toBase64Url(String.fromCharCode(...new Uint8Array(signed)));
    if (safeEquals(suppliedSignature, expectedSignature)) return true;
  }
  const previewEnabled = isTruthy(env?.PREVIEW_BYPASS_LOGIN ?? env?.NEXT_PUBLIC_PREVIEW_BYPASS_LOGIN ?? env?.VITE_PREVIEW_BYPASS_LOGIN);
  return previewEnabled && request.headers.get('x-preview-bypass-login') === 'true';
}

function safeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

async function getSupabaseAuthUser(request, env) {
  const token = getBearerToken(request);
  if (!token) return null;
  const { url: supabaseUrl, key: publishableKey } = getPublishableSupabaseConfig(env);
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: publishableKey, Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function getUserProfileRole(userId, email, env) {
  if (!userId && !email) return '';
  const { url: supabaseUrl, key } = getSecretSupabaseConfig(env);
  const filters = [];
  if (userId) filters.push(`id.eq.${encodeURIComponent(userId)}`);
  if (email) filters.push(`email.eq.${encodeURIComponent(email)}`);
  const orFilter = filters.length > 1 ? `or=(${filters.join(',')})` : filters[0]?.replace('.', '=');
  const url = filters.length > 1
    ? `${supabaseUrl}/rest/v1/users?select=id,email,role&${orFilter}&limit=1`
    : `${supabaseUrl}/rest/v1/users?select=id,email,role&${orFilter}&limit=1`;
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) return '';
  const rows = await res.json().catch(() => []);
  return String(rows?.[0]?.role || '');
}

export async function getRequestRole(request, env) {
  if (await isDeveloperRequest(request, env)) return 'Developer';
  const authUser = await getSupabaseAuthUser(request, env);
  const role = await getUserProfileRole(authUser?.id, authUser?.email, env);
  return role || String(authUser?.user_metadata?.role || authUser?.role || '');
}

async function auditDeniedCrud({ request, env, role, action = 'CRUD' }) {
  const tokenPayload = decodeJwtPayload(getBearerToken(request));
  const authUser = await getSupabaseAuthUser(request, env).catch(() => null);
  const entry = {
    user: authUser?.email || tokenPayload?.username || tokenPayload?.sub || 'anonymous',
    role: role || '',
    action,
    page: new URL(request.url).pathname,
    timestamp: new Date().toISOString(),
    reason: READ_ONLY_REASON,
  };
  console.warn('[AUTHZ_DENIED]', JSON.stringify(entry));
  try {
    const { url: supabaseUrl, key } = getSecretSupabaseConfig(env);
    await fetch(`${supabaseUrl}/rest/v1/activity_logs`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ user_name: entry.user, role: entry.role, action: `DENIED_${action}`, module: entry.page, detail: READ_ONLY_REASON, status: 'FAILED', metadata: entry }),
    }).catch(() => null);
  } catch (_err) {}
}

export async function requirePicRole({ request, env, action = 'CRUD' }) {
  const role = await getRequestRole(request, env);
  const canCrud = String(role || '').toLowerCase().includes('pic') || await isDeveloperRequest(request, env);
  if (canCrud) return { ok: true, role };
  await auditDeniedCrud({ request, env, role, action });
  return { ok: false, role, response: json({ success: false, message: 'Akses read-only. Hanya PIC atau Developer yang bisa mengubah data.', reason: READ_ONLY_REASON }, 403) };
}
