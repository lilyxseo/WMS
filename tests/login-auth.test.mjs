import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/login.js';

const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key', SUPABASE_SECRET_KEY: 'sb_secret_must-not-be-used' };
const request = body => new Request('https://app.example/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('email login uses the publishable key, then returns both tokens', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, `${env.SUPABASE_URL}/auth/v1/token?grant_type=password`);
    assert.equal(init.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(init.headers.Authorization, `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`);
    assert.ok(!JSON.stringify(init).includes(env.SUPABASE_SECRET_KEY));
    assert.deepEqual(JSON.parse(init.body), { email: 'user@example.com', password: 'correct-password' });
    return Response.json({ access_token: 'access-token', refresh_token: 'refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: 12345, user: { id: 'user-id' } });
  };
  const response = await onRequestPost({ request: request({ identifier: 'user@example.com', password: 'correct-password' }), env });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.session.access_token, 'access-token');
  assert.equal(payload.session.refresh_token, 'refresh-token');
});

test('invalid email credentials return a generic safe reason and diagnostic', async t => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const diagnostics = [];
  t.after(() => { globalThis.fetch = originalFetch; console.info = originalInfo; });
  console.info = (...args) => diagnostics.push(args.join(' '));
  globalThis.fetch = async () => Response.json({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, { status: 400 });
  const response = await onRequestPost({ request: request({ identifier: 'user@example.com', password: 'wrong-password' }), env });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, reason: 'INVALID_LOGIN_CREDENTIALS', message: 'Username atau password salah.' });
  assert.ok(diagnostics.includes('[Login] supabase auth status: rejected_400'));
  assert.ok(diagnostics.includes('[Login] final rejection reason: SUPABASE_INVALID_CREDENTIALS'));
  assert.ok(!JSON.stringify(diagnostics).includes('wrong-password'));
  assert.ok(!JSON.stringify(diagnostics).includes(env.SUPABASE_PUBLISHABLE_KEY));
});

test('username is resolved with the secret key before password auth uses the publishable key', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/rest/v1/users?')) {
      assert.equal(init.headers.apikey, env.SUPABASE_SECRET_KEY);
      assert.equal(init.headers.Authorization, `Bearer ${env.SUPABASE_SECRET_KEY}`);
      const lookupUrl = new URL(url);
      assert.equal(lookupUrl.searchParams.get('select'), 'email');
      assert.equal(lookupUrl.searchParams.get('username'), 'ilike.bydrz');
      assert.equal(lookupUrl.searchParams.get('limit'), '1');
      return Response.json([{ email: 'resolved@example.com' }]);
    }
    assert.equal(init.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(init.headers.Authorization, `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`);
    assert.deepEqual(JSON.parse(init.body), { email: 'resolved@example.com', password: 'correct-password' });
    return Response.json({ access_token: 'access-token', refresh_token: 'refresh-token', user: { id: 'user-id', email: 'resolved@example.com' } });
  };

  const response = await onRequestPost({ request: request({ identifier: 'bydrz', password: 'correct-password' }), env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(calls.length, 2);
});

test('configured developer username resolves to its configured email and creates a signed session', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    assert.match(String(url), /\/rest\/v1\/users\?/);
    assert.equal(new URL(url).searchParams.get('username'), 'ilike.Developer');
    return Response.json([{ email: 'developer@example.com' }]);
  };
  const developerEnv = {
    ...env,
    DEV_LOGIN_ENABLED: 'true',
    DEV_USERNAME: ' DEVELOPER@EXAMPLE.COM ',
    DEV_PASSWORD: 'Exact-Password',
    DEV_SESSION_SECRET: 'test-session-signing-secret',
  };
  const response = await onRequestPost({ request: request({ identifier: ' Developer ', password: 'Exact-Password' }), env: developerEnv });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.mode, 'dev');
  assert.equal(payload.user.role, 'Mode Development');
  assert.match(payload.session.access_token, /^[^.]+\.[^.]+$/);
  assert.equal(calls, 1, 'developer credentials must not be sent to Supabase Auth');
});

test('developer email is intentionally supported and wrong password returns 401 without Auth', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('Supabase must not be called'); };
  const developerEnv = {
    ...env,
    DEV_LOGIN_ENABLED: 'true',
    DEV_USERNAME: 'developer@example.com',
    DEV_PASSWORD: 'Exact-Password',
    DEV_SESSION_SECRET: 'test-session-signing-secret',
  };
  const response = await onRequestPost({ request: request({ identifier: ' Developer@Example.com ', password: 'wrong-password' }), env: developerEnv });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, reason: 'INVALID_LOGIN_CREDENTIALS', message: 'Username atau password salah.' });
});

test('matched developer account fails closed when its server configuration is incomplete', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('Supabase must not be called'); };
  const response = await onRequestPost({
    request: request({ identifier: 'developer@example.com', password: 'password' }),
    env: { ...env, DEV_LOGIN_ENABLED: 'true', DEV_USERNAME: 'developer@example.com', DEV_PASSWORD: 'password' },
  });
  assert.equal(response.status, 401);
});

test('unknown username returns the same generic credential error without calling Auth', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json([]); };
  const response = await onRequestPost({ request: request({ identifier: 'missing-user', password: 'password' }), env });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, reason: 'INVALID_LOGIN_CREDENTIALS', message: 'Username atau password salah.' });
  assert.equal(calls, 1);
});

test('legacy username field is rejected as an invalid payload', async () => {
  const response = await onRequestPost({ request: request({ username: 'user', password: 'password' }), env });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, reason: 'INVALID_LOGIN_PAYLOAD', message: 'Username/email dan password wajib diisi.' });
});

test('frontend sends the identifier to login API and does not query users to resolve username', async () => {
  const { readFile } = await import('node:fs/promises');
  const mainSource = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  const authSource = await readFile(new URL('../assets/js/supabase.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mainSource, /resolveEmailFromLoginInput|\.select\(["']email["']\)\.eq\(["']username["']/);
  assert.match(authSource, /JSON\.stringify\(\{ identifier, password \}\)/);
});
