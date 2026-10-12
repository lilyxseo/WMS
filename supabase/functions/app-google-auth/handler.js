import { googleToken } from '../whatsapp-fonnte/sheet-edit.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function handleAppGoogleAuth(request, env, fetchFn = fetch) {
  if (request.method !== 'POST') return json({ success: false }, 405);
  const key = request.headers.get('apikey') || '';
  if (request.headers.get('authorization') !== `Bearer ${key}` || !key) return json({ success: false }, 401);
  const legacyServerKey = [env.SUPABASE_SERVICE_ROLE_KEY, env.WMS_SUPABASE_SECRET_KEY].filter(Boolean).includes(key);
  if (!legacyServerKey && !/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return json({ success: false }, 401);
  // Validate the application's existing secret key with the project's admin API.
  // A publishable key or logged-in user's JWT cannot obtain a Google token.
  if (!legacyServerKey) {
    try {
      const response = await fetchFn(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/auth/v1/admin/users?page=1&per_page=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return json({ success: false }, response.status >= 500 ? 503 : 401);
      if (response.body) await response.body.cancel();
    } catch { return json({ success: false }, 503); }
  }
  if (!['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN'].every(name => Boolean(env[name]))) {
    return json({ success: false, code: 'OAUTH_CONFIG_MISSING' }, 503);
  }
  try {
    const access_token = await googleToken(env, fetchFn);
    return json({ access_token });
  } catch {
    // Never relay Google error bodies, secrets or refresh tokens to callers.
    return json({ success: false, code: 'OAUTH_AUTHENTICATION_FAILED' }, 502);
  }
}
