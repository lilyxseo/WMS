import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGoogleCheck } from '../supabase/functions/whatsapp-fonnte/google-check.js';
import { GoogleAccessError, googleResponseError, formatGoogleFailure } from '../supabase/functions/whatsapp-fonnte/google-errors.js';
import { handleFonnteWebhook } from '../supabase/functions/whatsapp-fonnte/handler.js';
const env = { GOOGLE_OAUTH_CLIENT_ID: 'private-client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'private-client-secret', GOOGLE_OAUTH_REFRESH_TOKEN: 'private-refresh-token', SHEET_ID_2026: 'transactions', SHEET_ID_INVENTORY: 'inventory' };

test('Google diagnostics authenticate and check required tabs without writing spreadsheets or sessions', async () => {
 const calls = [];
 const fetchFn = async (url, options = {}) => {
  calls.push({ url, options });
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'private-access-token' });
  assert.equal(options.method, undefined);
  if (url.endsWith('/userinfo')) return Response.json({ email: 'gmail@test.invalid' });
  if (url.includes('/values/')) return Response.json({ values: [['Inventory'], ['Lokasi', 'SKU', 'Nama Barang', 'Saldo Akhir']] });
  const titles = url.includes('/transactions?') ? ['Kartu Stock','Barang Masuk','Barang KeIuar'] : ['Movement'];
  return Response.json({ sheets: titles.map(title => ({ properties: { title } })) });
 };
 const reply = await handleGoogleCheck('cek google', env, fetchFn);
 assert.match(reply, /OAuth Gmail/); assert.match(reply, /Akun OAuth: gmail@test.invalid/); assert.match(reply, /Autentikasi: berhasil/); assert.match(reply, /Tab wajib: tersedia/);
 assert.match(reply, /Tidak ada transaksi ditulis/); assert.match(reply, /Izin Editor\/proteksi tab belum diuji/);
 assert.doesNotMatch(reply, /private-client|private-refresh|private-access/); assert.match(reply, /Header Kartu Stock: sesuai, baris 2/); assert.equal(calls.length, 5);
});
test('missing configuration and invalid grants produce actionable errors without writing or exposing raw Google responses', async () => {
 const noFetch = () => { throw new Error('Should not fetch'); };
 assert.match(await handleGoogleCheck('cek google', { GOOGLE_OAUTH_CLIENT_ID: 'test' }, noFetch), /Kredensial belum lengkap/);
 assert.match(await handleGoogleCheck('cek google', { ...env, SHEET_ID_2026: '' }, noFetch), /SHEET_ID_2026 belum diisi/);
 for (const [error, expected] of [['invalid_grant','OAUTH_INVALID_GRANT'],['invalid_client','OAUTH_INVALID_CLIENT']]) {
  const reply = await handleGoogleCheck('cek google', env, async () => Response.json({ error, error_description: 'private-client-secret' }, { status: 400 }));
  assert.match(reply, new RegExp(expected)); assert.match(reply, /Tidak ada transaksi ditulis/); assert.doesNotMatch(reply, /private-client-secret/);
 }
 assert.equal(await handleGoogleCheck('inbound', env, noFetch), undefined);
});
test('Google response classification distinguishes permissions, scopes, API configuration and missing sheets', async () => {
 for (const [status, error, expected] of [[403,{ details: [{ reason: 'SERVICE_DISABLED' }] },'SHEETS_API_DISABLED'],[403,{ details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] },'SHEETS_SCOPE_MISSING'],[403,{},'SHEETS_PERMISSION_DENIED'],[404,{},'SPREADSHEET_NOT_FOUND'],[400,{ message: 'Unable to parse range: private-data' },'SHEET_TAB_MISSING'],[429,{},'GOOGLE_RATE_LIMIT']]) {
  const result = await googleResponseError(Response.json({ error }, { status }));
  assert.equal(result.code, expected); assert.equal(result.writeAttempted, false); assert.doesNotMatch(result.userMessage, /private-data/);
 }
 const before = formatGoogleFailure(new GoogleAccessError('OAUTH_INVALID_GRANT','Refresh token ditolak.'), 'reference', 'Barang Masuk');
 assert.match(before, /Tidak ada transaksi ditulis/);
 const after = formatGoogleFailure(new GoogleAccessError('GOOGLE_HTTP_500','Google gagal.', true), 'reference', 'Barang Masuk');
 assert.match(after, /Status penulisan belum terkonfirmasi/); assert.doesNotMatch(after, /Tidak ada transaksi ditulis/);
});
test('diagnostics report missing tabs and a wrong spreadsheet ID without pretending writes were verified', async () => {
 const reply = await handleGoogleCheck('cek google', env, async url => {
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test' });
  if (url.includes('/transactions?')) return Response.json({ sheets: [{ properties: { title: 'Barang Masuk' } }] });
  return Response.json({ error: { message: 'private details' } }, { status: 404 });
 });
 assert.match(reply, /Tab belum ditemukan: Barang KeIuar/); assert.match(reply, /SPREADSHEET_NOT_FOUND/); assert.doesNotMatch(reply, /private details/);
});
test('diagnostic command works in the webhook while preserving an active transaction draft', async () => {
 let sent, writes = 0;
 const fetchFn = async (url, options = {}) => {
  if (url.endsWith('/send')) { sent = options.body.get('message'); return Response.json({ status: true }); }
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test' });
  if (url.includes('sheets.googleapis.com')) { if (options.method) writes++; return Response.json({ sheets: ['Kartu Stock','Barang Masuk','Barang KeIuar','Movement'].map(title => ({ properties: { title } })) }); }
  throw new Error('Must not read or replace the active draft');
 };
 const request = new Request('https://test/?secret=secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: '6281234567890', message: 'cek google' }) });
 const response = await handleFonnteWebhook({ request, env: { ...env, SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', FONNTE_WEBHOOK_SECRET: 'secret', FONNTE_TOKEN: 'test', WHATSAPP_ALLOWED_NUMBERS: '6281234567890' } }, fetchFn);
 assert.equal(response.status, 200); assert.match(sent, /Autentikasi: berhasil/); assert.equal(writes, 0);
});
