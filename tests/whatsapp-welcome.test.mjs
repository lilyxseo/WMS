import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWelcome } from '../supabase/functions/whatsapp-fonnte/welcome.js';
import { isMainMenu, resolveMenu } from '../supabase/functions/whatsapp-fonnte/menu.js';
import { handleFonnteWebhook } from '../supabase/functions/whatsapp-fonnte/handler.js';
const profile = { id: 'user-id', phone_number: '6281234567890', full_name: 'Andi', role: 'PIC Inventory' };

test('welcome follows Jakarta business time across every greeting boundary', () => {
 for (const [localTime, expected] of [['04:59','malam'],['05:00','pagi'],['10:59','pagi'],['11:00','siang'],['14:59','siang'],['15:00','sore'],['17:59','sore'],['18:00','malam'],['23:59','malam']]) {
  const message = renderWelcome(profile, new Date(`2026-10-12T${localTime}:00+07:00`));
  assert.match(message, new RegExp(`Selamat ${expected}, Andi!`)); assert.match(message, /Role: \*PIC Inventory\*/);
 }
 assert.match(renderWelcome(profile, new Date('2026-10-11T23:00:00Z')), /Selamat pagi/);
});
test('welcome sanitizes profile formatting and handles missing profiles without inventing identity', () => {
 assert.match(renderWelcome({ full_name: '*Andi*\nhello', role: '_PIC_' }), /Andi hello!.*\*/);
 assert.match(renderWelcome(undefined), /Nama dan role belum tersedia/);
 assert.match(renderWelcome({ username: 'andi' }), /andi!/);
 assert.match(renderWelcome(profile, new Date('2026-10-12T01:00:00Z'), 'invalid-timezone'), /Selamat pagi/);
 for (const command of ['menu','halo','hai','selamat pagi','selamat siang','selamat sore','selamat malam']) { assert.equal(isMainMenu(command), true); assert.match(resolveMenu(command), /Menu WMS/); }
 assert.equal(isMainMenu('menu masuk'), false);
});
test('webhook welcomes the verified phone profile and preserves menu features', async () => {
 const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', FONNTE_TOKEN: 'test', FONNTE_WEBHOOK_SECRET: 'secret' };
 let reply, profileReads = 0, clearedDraft = false;
 const fetchFn = async (url, options = {}) => {
  if (url.includes('/users?')) { profileReads++; return Response.json([profile]); }
  if (url.includes('whatsapp_search_sessions')) {
   if (options.method === 'POST') { clearedDraft = true; assert.deepEqual(JSON.parse(options.body).search, {}); return new Response(null, { status: 204 }); }
   return Response.json(clearedDraft ? [] : [{ search: { kind: 'pdf-import', phase: 'confirm', profileId: profile.id } }]);
  }
  if (url.endsWith('/send')) { reply = options.body.get('message'); return Response.json({ status: true }); }
  throw new Error('Unexpected fetch');
 };
 const request = new Request('https://test/?secret=secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: profile.phone_number, message: 'halo' }) });
 assert.equal((await handleFonnteWebhook({ request, env }, fetchFn)).status, 200);
 assert.match(reply, /Andi!/); assert.match(reply, /Role: \*PIC Inventory\*/); assert.match(reply, /Selamat datang di \*Bot WMS\*/); assert.match(reply, /7\. Outbount/);
 assert.equal(profileReads, 1); assert.equal(clearedDraft, true);
 assert.match(reply, /9\. Ringkasan harian/); assert.doesNotMatch(reply, /Import PDF/);
});
