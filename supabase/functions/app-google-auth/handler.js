const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function handleAppGoogleAuth(request, env, fetchFn = fetch) {
  if (request.method !== 'POST') return json({ success: false }, 405);
  // Supabase's gateway may rewrite Authorization when translating API keys.
  // Preserve the server credential in a dedicated header and validate it here.
  const key = request.headers.get('x-wms-server-key') || request.headers.get('apikey') || '';
  if (!key) return json({ success: false }, 401);
  const legacyServerKey = [env.SUPABASE_SERVICE_ROLE_KEY, env.WMS_SUPABASE_SECRET_KEY].filter(Boolean).includes(key);
  if (!legacyServerKey && !/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return json({ success: false, code: 'SERVER_KEY_REJECTED' }, 401);
  // Validate the application's existing secret key with the project's admin API.
  // A publishable key or logged-in user's JWT cannot obtain a Google token.
  if (!legacyServerKey) {
    try {
      const response = await fetchFn(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/auth/v1/admin/users?page=1&per_page=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return json({ success: false, code: 'SERVER_KEY_INVALID' }, response.status >= 500 ? 503 : 401);
      if (response.body) await response.body.cancel();
    } catch { return json({ success: false }, 503); }
  }
  if (!['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN'].every(name => Boolean(env[name]))) {
    return json({ success: false, code: 'OAUTH_CONFIG_MISSING' }, 503);
  }
  try {
    const response = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token',
        client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN }),
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token) {
      return json({ success: false, code: 'OAUTH_AUTHENTICATION_FAILED' }, 502);
    }
    return json({ access_token: payload.access_token });
  } catch {
    // Never relay Google error bodies, secrets or refresh tokens to callers.
    return json({ success: false, code: 'OAUTH_AUTHENTICATION_FAILED' }, 502);
  }
}
