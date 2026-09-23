import test from 'node:test';
import assert from 'node:assert/strict';

import { getRequestRole } from '../functions/api/_authz.js';
import { onRequestPost } from '../functions/api/login.js';

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key',
  SUPABASE_SECRET_KEY: 'sb_secret_test-key',
  DEV_LOGIN_ENABLED: 'true',
  DEV_USERNAME: 'developer@example.com',
  DEV_PASSWORD: 'Exact-Password',
  DEV_SESSION_SECRET: 'strong-test-session-secret',
};

test('protected API authorization accepts only the signed explicit developer session', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('email developer login must not call Supabase'); };

  const loginResponse = await onRequestPost({
    request: new Request('https://app.example/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'developer@example.com', password: 'Exact-Password' }),
    }),
    env,
  });
  const login = await loginResponse.json();
  const protectedRequest = new Request('https://app.example/api/protected', {
    headers: { Authorization: `Bearer ${login.session.access_token}` },
  });

  assert.equal(await getRequestRole(protectedRequest, env), 'Developer');
});
