import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost,onRequestGet} from '../functions/api/movement/in.js';
import {createVerifiedDevToken} from '../functions/api/_note-identity.js';
const env={DEV_LOGIN_ENABLED:'true',DEV_USERNAME:'test',DEV_SESSION_SECRET:'test-only-signing-key',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SHEET_ID_INVENTORY:'inventory',SHEET_ID_2026:'ledger'};
const id='11111111-1111-4111-8111-111111111111';
const items=[{from:'A',to:'B',sku:'0012',namaBarang:'Product',qty:2,stokDiLokasiAwal:10,stokAktual:2}];
async function fixture(t,{failDestination,lateFailure,holdInventory,failFinalCheckpoint}={}){
 const original=globalThis.fetch,jobs=new Map(),receipts=new Map(),writes=[],reads=[];let release;
 t.after(()=>globalThis.fetch=original);
 const token=await createVerifiedDevToken(env,'test');
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input),body=options.body?JSON.parse(options.body):null;
  if(url.pathname.includes('app-google-auth'))return Response.json({access_token:'google'});
  if(url.hostname==='test.supabase.co'){
   assert.equal(url.pathname,'/rest/v1/stock_entry_batches');
   if(options.method==='POST'){if(jobs.has(body.id))return Response.json([]);jobs.set(body.id,{...body,updated_at:new Date().toISOString()});return Response.json([structuredClone(jobs.get(body.id))]);}
   const key=url.searchParams.get('id')?.slice(3),job=jobs.get(key);if(options.method==='PATCH'){
    if(failFinalCheckpoint&&body.status==='saved')throw TypeError('DB reply lost');
    if(!job||url.searchParams.get('run')!=='eq.'+job.run||url.searchParams.has('status')&&url.searchParams.get('status')!=='eq.'+job.status)return Response.json([]);
    Object.assign(job,body);return Response.json([structuredClone(job)]);
   }
   return Response.json(job&&url.searchParams.get('owner')==='eq.'+job.owner?[structuredClone(job)]:[]);
  }
  assert.equal(url.hostname,'sheets.googleapis.com');const destination=url.pathname.includes('/inventory')?'inventory':'barangMasuk';
  if(url.pathname.endsWith('/developerMetadata:search'))return Response.json({matchedDeveloperMetadata:receipts.has(destination)?[{developerMetadata:{metadataValue:receipts.get(destination)}}]:[]});
  if(options.method==='POST'){
   assert.ok(url.pathname.endsWith(':batchUpdate'));assert.equal(body.requests.length,3);assert.ok(body.requests[0].insertDimension);assert.ok(body.requests[1].updateCells);assert.ok(body.requests[2].createDeveloperMetadata);assert.deepEqual(body.requests[2].createDeveloperMetadata.developerMetadata.location,{spreadsheet:true});
   if(failDestination===destination)return Response.json({error:{message:'The caller does not have permission'}},{status:403});
   writes.push({destination,body});receipts.set(destination,body.requests[2].createDeveloperMetadata.developerMetadata.metadataValue);
   if(holdInventory&&destination==='inventory')await new Promise(resolve=>release=resolve);
   if(lateFailure===destination)throw TypeError('Reply lost after write');
   return Response.json({replies:[{},{}]});
  }
  reads.push(url.toString());if(url.pathname.includes('/values/'))return Response.json({values:[['TANGGAL','FROM','TO','SKU','Nama Barang','Qty'],['11/1/2026','A','B','EXISTING','Product',3],[],[],['11/16/2026','A','B','MISPLACED','Product',2]]});return Response.json({sheets:[{properties:{title:destination==='inventory'?'Movement':'Barang Masuk',sheetId:destination==='inventory'?1:2,gridProperties:{rowCount:1000}}}]});
 };
 const request=(method='POST',payload={id,items})=>new Request('https://wms.test/api/movement/in'+(method==='GET'?'?id='+id:''),{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(payload)}:{})});
 return {jobs,receipts,writes,reads,post:payload=>onRequestPost({request:request('POST',payload),env}),get:()=>onRequestGet({request:request('GET'),env}),release:()=>release()};
}
test('both destinations fill the first empty business row atomically with a receipt, preserve SKU text, and duplicate ID never writes twice',async t=>{
 const f=await fixture(t),response=await f.post(),data=await response.json();assert.equal(response.status,200);assert.equal(data.success,true);assert.deepEqual(data.destinations,{inventory:'saved',barangMasuk:'saved'});assert.equal(f.writes.length,2);assert.equal(f.writes[0].body.requests[1].updateCells.rows[0].values[3].userEnteredValue.stringValue,'0012');assert.ok(Number.isFinite(f.writes[0].body.requests[1].updateCells.rows[0].values[0].userEnteredValue.numberValue));assert.equal(f.writes[1].body.requests[1].updateCells.rows[0].values[0].userEnteredFormat.numberFormat.type,'DATE');assert.equal(f.reads.length,4);assert.equal(f.writes[0].body.requests[1].updateCells.start.rowIndex,2);assert.equal(f.writes[1].body.requests[1].updateCells.start.rowIndex,2);assert.ok(f.reads.filter(url=>url.includes('/values/')).every(url=>/!A:[EF]$/.test(decodeURIComponent(url))));
 const reordered=items.map(item=>Object.fromEntries(Object.entries(item).reverse()));const again=await f.post({id,items:reordered});assert.equal((await again.json()).replayed,true);assert.equal(f.writes.length,2);
 const changed=await f.post({id,items:[{...items[0],qty:3}]});assert.notEqual(changed.status,200);assert.equal(f.writes.length,2);
});
test('concurrent duplicate while the first batch writes does not append again',async t=>{
 const f=await fixture(t,{holdInventory:true}),pending=f.post();while(!f.writes.length)await new Promise(setImmediate);const duplicate=await f.post();assert.equal(duplicate.status,409);assert.equal(f.writes.length,1);f.release();assert.equal((await pending).status,200);assert.equal(f.writes.length,2);
});
test('first destination permission denial proves no writes and permits same-ID retry',async t=>{
 const f=await fixture(t,{failDestination:'inventory'}),res=await f.post(),data=await res.json();assert.equal(res.status,403);assert.equal(data.writeState,'not_started');assert.equal(f.jobs.get(id).status,'failed');assert.equal(f.writes.length,0);
});
test('partial write is uncertain, reports the saved destination, and cannot POST again',async t=>{
 const f=await fixture(t,{failDestination:'barangMasuk'}),res=await f.post(),data=await res.json();assert.equal(res.status,403);assert.equal(data.writeState,'uncertain');assert.equal(data.destinations.inventory,'saved');assert.equal(f.writes.length,1);assert.equal((await f.post()).status,409);assert.equal(f.writes.length,1);const check=await f.get();assert.equal(check.status,409);assert.equal((await check.json()).success,false);
});
test('lost second reply and lost final database checkpoint recover from both sheet receipts without writing',async t=>{
 for(const option of [{lateFailure:'barangMasuk'},{failFinalCheckpoint:true}]){
  const f=await fixture(t,option);assert.equal((await f.post()).status,500);assert.equal(f.writes.length,2);
  // A transient DB checkpoint outage has cleared before reconciliation.
  if(option.failFinalCheckpoint){const originalFetch=globalThis.fetch;globalThis.fetch=async(url,opts)=>{if(opts?.method==='PATCH'&&JSON.parse(opts.body).status==='saved'){const job=f.jobs.get(id);Object.assign(job,JSON.parse(opts.body));return Response.json([job]);}return originalFetch(url,opts);};}
  const check=await f.get();assert.equal(check.status,200);assert.equal((await check.json()).success,true);assert.equal(f.writes.length,2);
 }
});
test('lost first reply keeps the batch locked with a receipt for only Inventory',async t=>{
 const f=await fixture(t,{lateFailure:'inventory'});assert.equal((await f.post()).status,500);assert.equal((await f.post()).status,409);assert.equal(f.writes.length,1);assert.equal((await f.get()).status,409);
});
test('missing ID and unowned receipt cannot bypass duplicate prevention',async t=>{
 const f=await fixture(t);assert.equal((await f.post({items})).status,400);assert.equal(f.writes.length,0);assert.equal((await f.get()).status,404);
});
