import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAppGoogleAuth } from '../supabase/functions/app-google-auth/handler.js';
import { getGoogleAccessToken } from '../functions/api/_google-auth.js';
import { onRequestPut } from '../functions/api/update-row.js';
import { onRequestDelete } from '../functions/api/delete-row.js';
import { onRequestPost as createRow } from '../functions/api/sheet-input.js';

const oauth = { SUPABASE_URL: 'https://project.supabase.co', GOOGLE_OAUTH_CLIENT_ID: 'client', GOOGLE_OAUTH_CLIENT_SECRET: 'private-client', GOOGLE_OAUTH_REFRESH_TOKEN: 'private-refresh' };
const appEnv = { SUPABASE_URL: oauth.SUPABASE_URL, SUPABASE_SECRET_KEY: 'sb_secret_server', SHEET_ID_INVENTORY: 'inventory', SHEET_ID_2026: 'transactions' };
const bridgeRequest = (key = 'sb_secret_server') => new Request(`${oauth.SUPABASE_URL}/functions/v1/app-google-auth`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}` } });

test('Gmail bridge rejects anonymous, publishable keys and user sessions before OAuth', async () => {
 let calls = 0;
 const noFetch = async () => { calls++; throw new Error('must not fetch'); };
 for (const key of ['', 'sb_publishable_public', 'user-session-jwt']) {
  const response = await handleAppGoogleAuth(bridgeRequest(key), oauth, noFetch);
  assert.equal(response.status, 401); assert.equal(response.headers.get('Cache-Control'), 'no-store');
 }
 assert.equal((await handleAppGoogleAuth(new Request('https://test'), oauth, noFetch)).status, 405);
 assert.equal(calls, 0);
});

test('Gmail bridge verifies secret key before refreshing the configured Gmail token', async () => {
 const calls = [];
 const response = await handleAppGoogleAuth(bridgeRequest(), oauth, async (url, init) => {
  calls.push(url);
  if (url.includes('/auth/v1/admin/users')) { assert.equal(init.headers.apikey, appEnv.SUPABASE_SECRET_KEY); return Response.json({users:[]}); }
  assert.equal(url, 'https://oauth2.googleapis.com/token');
  assert.equal(init.body.get('grant_type'), 'refresh_token');
  assert.equal(init.body.get('client_id'), oauth.GOOGLE_OAUTH_CLIENT_ID);
  assert.equal(init.body.get('refresh_token'), oauth.GOOGLE_OAUTH_REFRESH_TOKEN);
  return Response.json({access_token:'gmail-access'});
 });
 assert.equal(response.status, 200); assert.equal(calls.length, 2);
 assert.deepEqual(await response.json(), {access_token:'gmail-access'});
 assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('invalid server keys, incomplete OAuth and revoked refresh tokens fail closed', async () => {
 let oauthCalls = 0;
 const denied = await handleAppGoogleAuth(bridgeRequest(), oauth, async () => Response.json({}, {status:403}));
 assert.equal(denied.status, 401);
 const missing = await handleAppGoogleAuth(bridgeRequest(), {...oauth, GOOGLE_OAUTH_REFRESH_TOKEN: '', GOOGLE_CLIENT_EMAIL:'old', GOOGLE_PRIVATE_KEY:'old'}, async () => Response.json({}));
 assert.equal(missing.status, 503);
 const revoked = await handleAppGoogleAuth(bridgeRequest(), oauth, async url => {
  if (url.includes('/admin/users')) return Response.json({});
  oauthCalls++; return Response.json({error:'invalid_grant', error_description:'private-refresh'}, {status:400});
 });
 assert.equal(revoked.status, 502); assert.equal(oauthCalls, 1);
 assert.doesNotMatch(await revoked.text(), /private-refresh|private-client/);
});

test('Pages requests a Gmail token with server credentials and never falls back to its old service account', async () => {
 assert.equal(await getGoogleAccessToken(appEnv, async (url, init) => {
  assert.equal(url, `${oauth.SUPABASE_URL}/functions/v1/app-google-auth`);
  assert.equal(init.headers.apikey, appEnv.SUPABASE_SECRET_KEY);
  assert.equal(init.redirect, 'error'); return Response.json({access_token:'gmail-access'});
 }), 'gmail-access');
 let calls = 0;
 await assert.rejects(getGoogleAccessToken({...appEnv, GOOGLE_CLIENT_EMAIL:'old', GOOGLE_PRIVATE_KEY:'old'}, async () => {
  calls++; return Response.json({error:'private-refresh'}, {status:502});
 }), /Autentikasi Gmail/);
 assert.equal(calls, 1);
 await assert.rejects(getGoogleAccessToken({...appEnv, SUPABASE_SECRET_KEY:'sb_publishable_public'}, async () => { throw new Error('should not call'); }), /sb_secret_/);
});

function crudRequest(method, body) {
 return new Request('https://wms.test/api/update-row', {method, headers:{'Content-Type':'application/json','x-developer-user':'true'}, body:JSON.stringify(body)});
}
const row = {sheetKey:'movement', sheetName:'Movement', rowNumber:5, values:{sku:'001',nama_barang:'Pump'}};

test('application update and delete use the Gmail identity without Cloudflare Google credentials', async t => {
 const writes=[];
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  if (url.endsWith('/app-google-auth')) return Response.json({access_token:'gmail-access'});
  assert.equal(init.headers.Authorization, 'Bearer gmail-access');
  if (url.includes('?fields=')) return Response.json({sheets:[{properties:{sheetId:7,title:'Movement'}}]});
  writes.push({method:init.method,body:JSON.parse(init.body)}); return Response.json({});
 });
 const updated=await onRequestPut({request:crudRequest('PUT',row),env:appEnv});
 const deleted=await onRequestDelete({request:crudRequest('DELETE',row),env:appEnv});
 assert.equal(updated.status,200);assert.equal(deleted.status,200);assert.equal(writes.length,2);
 assert.doesNotMatch(await updated.text(), /gmail-access|sb_secret/);
 assert.doesNotMatch(await deleted.text(), /gmail-access|sb_secret/);
});

test('application CRUD never writes Sheets when central Gmail authentication fails', async t => {
 let calls=0;
 t.mock.method(globalThis, 'fetch', async url => { calls++; assert.ok(url.endsWith('/app-google-auth'));return Response.json({}, {status:502}); });
 const response=await onRequestPut({request:crudRequest('PUT',row),env:appEnv});
 assert.equal(response.status,500);assert.equal(calls,1);assert.match(await response.text(),/Autentikasi Gmail/);
});

test('application create uses central Gmail token and respects the existing PIC gate', async t => {
 let writes=0;
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  if (url.endsWith('/app-google-auth')) return Response.json({access_token:'gmail-access'});
  assert.equal(init.headers.Authorization,'Bearer gmail-access');writes++;return Response.json({});
 });
 const response=await createRow({request:crudRequest('POST',{sku:'001',nama_barang:'Pump',qty:1,lokasi:'A1'}),env:{...appEnv,GOOGLE_SHEET_ID:'inventory'}});
 assert.equal(response.status,200);assert.equal(writes,1);assert.doesNotMatch(await response.text(),/gmail-access|sb_secret/);
});

test('application create rejects unauthenticated users before contacting Gmail or Sheets', async t => {
 t.mock.method(globalThis, 'fetch', async url => {
  assert.ok(url.includes('/rest/v1/activity_logs')); return new Response(null, {status:201});
 });
 const request=new Request('https://wms.test/api/sheet-input', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:'001',nama_barang:'Pump',qty:1,lokasi:'A1'})});
 const response=await createRow({request,env:{...appEnv,GOOGLE_SHEET_ID:'inventory'}});
 assert.equal(response.status,403);assert.match(await response.text(),/READ_ONLY_ROLE/);
});

 test('Gmail bridge preserves server identity when the Supabase gateway rewrites Authorization', async () => {
  const request=new Request('https://test', {method:'POST',headers:{'X-WMS-Server-Key':'server-key',Authorization:'Bearer translated-gateway-jwt'}});
  const response=await handleAppGoogleAuth(request,{...oauth,SUPABASE_SERVICE_ROLE_KEY:'server-key'},async url=>{
   assert.equal(url,'https://oauth2.googleapis.com/token');return Response.json({access_token:'gmail-access'});
  });
  assert.equal(response.status,200);
 });

test('Balikan checkbox writes TRUE/FALSE with Gmail and hides its token from the browser', async t => {
 const { onRequestPatch } = await import('../functions/api/balikan-store/check.js');
 const writes=[];
 t.mock.method(globalThis,'fetch',async (url,init)=>{
  if(url.endsWith('/app-google-auth')) return Response.json({access_token:'gmail-access'});
  assert.equal(init.headers.Authorization,'Bearer gmail-access');
  if(init.method!=='PUT') return Response.json({values:[['Centang','SKU','Nama Barang','Qty']]});
  writes.push(JSON.parse(init.body).values[0][0]);return Response.json({});
 });
 for(const checked of [true,false]) {
  const response=await onRequestPatch({request:crudRequest('PATCH',{sheetName:'TRIP 1',rowNumber:12,checked}),env:appEnv});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true});
 }
 assert.deepEqual(writes,['TRUE','FALSE']);
});

test('Balikan checkbox preserves its cell when Gmail authentication fails', async t => {
 const { onRequestPatch } = await import('../functions/api/balikan-store/check.js');
 let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{calls++;assert.ok(url.endsWith('/app-google-auth'));return Response.json({}, {status:503});});
 const response=await onRequestPatch({request:crudRequest('PATCH',{sheetName:'TRIP 1',rowNumber:12,checked:true}),env:appEnv});
 assert.equal(response.status,500);assert.equal(calls,1);assert.match(await response.text(),/Autentikasi Gmail/);
});
