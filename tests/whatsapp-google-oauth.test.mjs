import test from 'node:test';
import assert from 'node:assert/strict';
import { googleToken, hasGoogleCredentials } from '../supabase/functions/whatsapp-fonnte/sheet-edit.js';
const oauth = { GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret', GOOGLE_OAUTH_REFRESH_TOKEN: 'test-refresh-token' };

test('Gmail OAuth exchanges the offline refresh token and takes precedence over service account credentials', async () => {
 const env = { ...oauth, GOOGLE_CLIENT_EMAIL: 'old@service.invalid', GOOGLE_PRIVATE_KEY: 'unused-invalid-key' };
 assert.equal(hasGoogleCredentials(env), true);
 let calls = 0;
 const token = await googleToken(env, async (url, options) => {
  calls++; assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.equal(options.method, 'POST');
  assert.deepEqual(Object.fromEntries(options.body), { grant_type: 'refresh_token', client_id: oauth.GOOGLE_OAUTH_CLIENT_ID, client_secret: oauth.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: oauth.GOOGLE_OAUTH_REFRESH_TOKEN });
  return Response.json({ access_token: 'oauth-access', token_type: 'Bearer', expires_in: 3600 });
 });
 assert.equal(token, 'oauth-access'); assert.equal(calls, 1);
});
test('partial OAuth configuration cannot silently fall back to the old service account identity', async () => {
 for (const missing of Object.keys(oauth)) {
  const env = { ...oauth, GOOGLE_CLIENT_EMAIL: 'old@service.invalid', GOOGLE_PRIVATE_KEY: 'old-key' }; delete env[missing];
  assert.equal(hasGoogleCredentials(env), false);
  await assert.rejects(googleToken(env, () => { throw new Error('Must not fetch'); }), /configuration incomplete/);
 }
 assert.equal(hasGoogleCredentials({ GOOGLE_CLIENT_EMAIL: 'old@service.invalid', GOOGLE_PRIVATE_KEY: 'old-key' }), true);
 assert.equal(hasGoogleCredentials({}), false);
});
test('revoked refresh token and invalid access token responses fail without leaking credentials', async () => {
 for (const response of [Response.json({ error: 'invalid_grant', error_description: 'sensitive-details' }, { status: 400 }), Response.json({}), Response.json({ access_token: 123 })]) {
  await assert.rejects(googleToken(oauth, async () => response), error => error.message === 'Google OAuth authentication failed');
 }
});
