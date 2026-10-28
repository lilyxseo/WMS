import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,fingerprint,formatMessage,contentSignature} from '../supabase/functions/warning-whatsapp/handler.js';
const row={category:'NEGATIVE_STOCK',source:'Kartu Stok',sourceRecord:4,sku:'0012',namaBarang:'Barang',categoryLabel:'Saldo Negatif',issue:'Saldo negatif',location:'A1'};
test('identity ignores sheet row shifts and distinguishes SKU and physical location',()=>{
 assert.equal(fingerprint(row),fingerprint({...row,issue:'Saldo -100',evidence:'changed'}));
 assert.equal(fingerprint(row),fingerprint({...row,sourceRecord:5}));
 assert.notEqual(fingerprint(row),fingerprint({...row,location:'A2'}));
 assert.notEqual(fingerprint(row),fingerprint({...row,sku:'12'}));
 assert.equal(fingerprint({...row,category:'OUTBOUND_WITHOUT_INBOUND'}),fingerprint({...row,category:'OUTBOUND_WITHOUT_INBOUND',sourceRecord:200}));
});
const env={SUPABASE_URL:'https://project.test',WMS_WARNING_DATA_KEY:'sb_secret_test',WMS_WARNING_NOTIFY_SECRET:'private',WMS_WARNING_RECIPIENTS:'628996628761',FONNTE_TOKEN:'fonnte'};
const request=action=>new Request('https://edge.test',{method:'POST',headers:{'X-WMS-Warning-Secret':'private'},body:JSON.stringify({action})});
function fixture({partial=false,action='run',send='ok',stale=false,unverified=false,eventType='new'}={}){
 const calls=[];let claimed=false;
 const handler=createHandler(env,{load:async(_e,options)=>{assert.equal(options.full,true);return {partial,snapshotStale:stale,total:150,verification:Array.from({length:5},()=>({ready:!unverified})),rows:[row]};},fetchFn:async(url,options)=>{
  calls.push({url,body:options.body});
  if(url.includes('fonnte')){if(send==='timeout')throw new Error('Timeout');return Response.json({status:send==='ok'});}
  const name=url.split('/').at(-1);if(name==='notification_allowed_numbers')return Response.json(['628996628761']);return Response.json(name==='warning_notify_lock'?true:name==='warning_notify_claim'?(claimed?[]:(claimed=true,[{id:'id',recipient:'628996628761',warning:row,event_type:eventType}])):{});
 }});
 return {handler,calls,action};
}
test('anonymous caller cannot trigger messages',async()=>{const f=fixture();assert.equal((await f.handler(new Request('https://edge.test',{method:'POST'}))).status,401);assert.equal(f.calls.length,0);});
test('check is read-only and initialize never sends',async()=>{for(const action of ['check','initialize']){const f=fixture();assert.equal((await f.handler(request(action))).status,200);assert.ok(!f.calls.some(c=>c.url.includes('fonnte')));}});
test('partial snapshot does not reconcile or notify',async()=>{const f=fixture({partial:true});await f.handler(request('run'));assert.deepEqual(f.calls.map(c=>c.url.split('/').at(-1)),['notification_allowed_numbers','notification_cancel_revoked','warning_notify_lock','warning_notify_unlock']);});
test('accepted delivery is recorded and no repeat in same run',async()=>{const f=fixture();await f.handler(request('run'));assert.equal(f.calls.filter(c=>c.url.includes('fonnte')).length,1);assert.equal(JSON.parse(f.calls.find(c=>c.url.endsWith('warning_notify_finish')).body).p_status,'sent');});
test('uncertain delivery is recorded without retry',async()=>{const f=fixture({send:'timeout'});await f.handler(request('run'));assert.equal(f.calls.filter(c=>c.url.includes('fonnte')).length,1);assert.equal(JSON.parse(f.calls.find(c=>c.url.endsWith('warning_notify_finish')).body).p_status,'uncertain');});
test('review messages preserve uncertainty',()=>assert.match(formatMessage([{...row,confidence:'review'}]),/Perlu verifikasi/));

test('content changes produce update signatures without changing warning identity',()=>{assert.notEqual(contentSignature(row),contentSignature({...row,issue:'Qty -100'}));assert.equal(contentSignature(row),contentSignature({...row,checkedAt:'later',id:'different'}));});
test('messages distinguish resolved, updated and reopened events and link to the primary domain',()=>{const message=formatMessage([{event_type:'resolved',warning:row},{event_type:'updated',warning:{...row,issue:'Qty -10'},previous_warning:row},{event_type:'reopened',warning:row}]);assert.match(message,/Selesai/);assert.match(message,/Diperbarui/);assert.match(message,/Muncul kembali/);assert.match(message,/gotoliving.app\/warning/);assert.match(message,/Sebelumnya/);});

test('stale or unverified snapshots never reconcile or deliver queued messages',async()=>{for(const options of [{stale:true},{unverified:true}]){const f=fixture(options);await f.handler(request('run'));assert.deepEqual(f.calls.map(call=>call.url.split('/').at(-1)),['notification_allowed_numbers','notification_cancel_revoked','warning_notify_lock','warning_notify_unlock']);}});
test('resolved messages are delivered with their event type and content signatures are persisted',async()=>{const f=fixture({eventType:'resolved'});await f.handler(request('run'));const send=f.calls.find(call=>call.url.includes('fonnte'));assert.match(send.body.get('message'),/Selesai/);const collect=JSON.parse(f.calls.find(call=>call.url.endsWith('warning_notify_collect')).body);assert.equal(collect.p_findings[0].content_signature,contentSignature(row));});
test('explicit provider rejection is marked failed for scheduled retry',async()=>{const f=fixture({send:'failed'});await f.handler(request('run'));assert.equal(JSON.parse(f.calls.find(call=>call.url.endsWith('warning_notify_finish')).body).p_status,'failed');});

test('sheet row evidence changes do not generate updated notifications',()=>{assert.equal(contentSignature(row),contentSignature({...row,evidence:'Baris 900 instead of 4',sourceRecord:900}));assert.notEqual(contentSignature(row),contentSignature({...row,issue:'Saldo negatif -20'}));});
test('legacy recipients are ignored when no user is enabled',async()=>{let sent=false;const handler=createHandler(env,{fetchFn:async(url)=>{if(url.includes('fonnte'))sent=true;return Response.json(url.endsWith('notification_allowed_numbers')?[]:{});}});const result=await (await handler(request('run'))).json();assert.equal(result.status,'no_recipients');assert.equal(sent,false);});
test('permission revoked after collection cancels delivery before sending',async()=>{let permissions=0,claims=0,sends=0,cancels=0;const handler=createHandler(env,{load:async()=>({partial:false,snapshotStale:false,verification:Array.from({length:5},()=>({ready:true})),rows:[row]}),fetchFn:async(url)=>{const name=url.split('/').at(-1);if(name==='notification_allowed_numbers')return Response.json(++permissions===1?['628996628761']:[]);if(name==='notification_cancel_revoked'){cancels++;return Response.json(null);}if(name==='warning_notify_lock')return Response.json(true);if(name==='warning_notify_claim')return Response.json(++claims===1?[{id:'id',recipient:'628996628761',warning:row}]:[]);if(url.includes('fonnte'))sends++;return Response.json({});}});await handler(request('run'));assert.equal(sends,0);assert.ok(cancels>=2);});
