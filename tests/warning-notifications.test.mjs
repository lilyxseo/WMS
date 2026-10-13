import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,fingerprint,formatMessage} from '../supabase/functions/warning-whatsapp/handler.js';
const row={category:'NEGATIVE_STOCK',source:'Kartu Stok',sourceRecord:4,sku:'0012',namaBarang:'Barang',categoryLabel:'Saldo Negatif',issue:'Saldo negatif',location:'A1'};
test('identity ignores quantity/evidence but distinguishes SKU and source row',()=>{
 assert.equal(fingerprint(row),fingerprint({...row,issue:'Saldo -100',evidence:'changed'}));
 assert.notEqual(fingerprint(row),fingerprint({...row,sourceRecord:5}));
 assert.notEqual(fingerprint(row),fingerprint({...row,sku:'12'}));
 assert.equal(fingerprint({...row,category:'OUTBOUND_WITHOUT_INBOUND'}),fingerprint({...row,category:'OUTBOUND_WITHOUT_INBOUND',sourceRecord:200}));
});
const env={SUPABASE_URL:'https://project.test',WMS_WARNING_DATA_KEY:'sb_secret_test',WMS_WARNING_NOTIFY_SECRET:'private',WMS_WARNING_RECIPIENTS:'628996628761',FONNTE_TOKEN:'fonnte'};
const request=action=>new Request('https://edge.test',{method:'POST',headers:{'X-WMS-Warning-Secret':'private'},body:JSON.stringify({action})});
function fixture({partial=false,action='run',send='ok'}={}){
 const calls=[];let claimed=false;
 const handler=createHandler(env,{load:async(_e,options)=>{assert.equal(options.full,true);return {partial,total:150,rows:[row]};},fetchFn:async(url,options)=>{
  calls.push({url,body:options.body});
  if(url.includes('fonnte')){if(send==='timeout')throw new Error('Timeout');return Response.json({status:send==='ok'});}
  const name=url.split('/').at(-1);return Response.json(name==='warning_notify_lock'?true:name==='warning_notify_claim'?(claimed?[]:(claimed=true,[{id:'id',recipient:'628996628761',warning:row}])):{});
 }});
 return {handler,calls,action};
}
test('anonymous caller cannot trigger messages',async()=>{const f=fixture();assert.equal((await f.handler(new Request('https://edge.test',{method:'POST'}))).status,401);assert.equal(f.calls.length,0);});
test('check is read-only and initialize never sends',async()=>{for(const action of ['check','initialize']){const f=fixture();assert.equal((await f.handler(request(action))).status,200);assert.ok(!f.calls.some(c=>c.url.includes('fonnte')));}});
test('partial snapshot does not reconcile or notify',async()=>{const f=fixture({partial:true});await f.handler(request('run'));assert.deepEqual(f.calls.map(c=>c.url.split('/').at(-1)),['warning_notify_lock','warning_notify_unlock']);});
test('accepted delivery is recorded and no repeat in same run',async()=>{const f=fixture();await f.handler(request('run'));assert.equal(f.calls.filter(c=>c.url.includes('fonnte')).length,1);assert.equal(JSON.parse(f.calls.find(c=>c.url.endsWith('warning_notify_finish')).body).p_status,'sent');});
test('uncertain delivery is recorded without retry',async()=>{const f=fixture({send:'timeout'});await f.handler(request('run'));assert.equal(f.calls.filter(c=>c.url.includes('fonnte')).length,1);assert.equal(JSON.parse(f.calls.find(c=>c.url.endsWith('warning_notify_finish')).body).p_status,'uncertain');});
test('review messages preserve uncertainty',()=>assert.match(formatMessage([{...row,confidence:'review'}]),/Perlu verifikasi/));
