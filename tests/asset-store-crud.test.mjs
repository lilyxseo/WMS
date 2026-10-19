import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest,ASSET_ID} from '../functions/api/asset-store/rows.js';
import {onRequest as oldCell} from '../functions/api/asset-store/cell.js';
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
async function run(method,extra={},options={}){
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init={})=>{
  calls.push({url,init});
  if(url.includes('/auth/v1/user'))return Response.json({id:'user-1'});
  if(url.includes('/rest/v1/users'))return Response.json([{role:'PIC Inventory',full_name:'User'}]);
  if(url.includes('/app-google-auth'))return Response.json({access_token:'test-access'});
  assert.ok(url.startsWith(`https://sheets.googleapis.com/v4/spreadsheets/${ASSET_ID}`));
  if(url.includes('?fields='))return Response.json({sheets:[{properties:{title:'ASSET A',gridProperties:{rowCount:100}}}]});
  if(decodeURIComponent(url).includes('!1:1'))return Response.json({values:[['SKU','Qty']]});
  if(!init.method||init.method==='GET')return Response.json({values:[options.formula&&url.includes('FORMULA')?['=A1',2]:['ABC',2]]});
  return Response.json({});
 };
 try{return {response:await onRequest({env,request:new Request('https://test/api/asset-store/rows',{method,headers:{Authorization:'Bearer user-session','Content-Type':'application/json'},body:JSON.stringify({sheetName:'ASSET A',columns:['SKU','Qty'],rowNumber:2,expected:['ABC','2'],values:['DEF','4'],...extra})})}),calls};}finally{globalThis.fetch=original;}
}
test('Asset create uses fixed spreadsheet and RAW values with numeric qty',async()=>{
 const {response,calls}=await run('POST',{spreadsheetId:'attacker',values:['=BAD()','4']});assert.equal(response.status,200);
 const write=calls.find(c=>c.init.method==='POST'&&c.url.includes(':append'));assert.ok(write);assert.ok(write.url.includes('valueInputOption=RAW'));assert.deepEqual(JSON.parse(write.init.body).values,[['=BAD()',4]]);
});
test('Asset update checks original data and writes the selected row',async()=>{
 const {response,calls}=await run('PATCH');assert.equal(response.status,200);const write=calls.find(c=>c.url.endsWith('/values:batchUpdate'));assert.ok(write);assert.equal(JSON.parse(write.init.body).data[0].range,"'ASSET A'!A2");
});
test('Asset stale data, changed headers and formulas cannot be overwritten',async()=>{
 for(const [extra,options] of [[{expected:['CHANGED','2']},{}],[{columns:['Qty','SKU']},{}],[{},{formula:true}]]){
  const {response,calls}=await run('PATCH',extra,options);assert.equal(response.status,409);assert.ok(!calls.some(c=>['PUT','POST'].includes(c.init.method)&&c.url.includes('sheets.googleapis.com')));
 }
});
test('Asset delete clears values without shifting other rows',async()=>{
 const {response,calls}=await run('DELETE');assert.equal(response.status,200);assert.ok(calls.some(c=>c.url.endsWith(':clear')));assert.ok(!calls.some(c=>c.url.includes('batchUpdate')));
});
test('Asset rejects non-asset sheets, header rows and invalid bodies',async()=>{
 for(const [method,body] of [['POST',{sheetName:'Inventory'}],['PATCH',{rowNumber:1}],['POST',{values:[]}],['POST',{values:['','']}]])assert.equal((await run(method,body)).response.status,400);
 assert.equal((await oldCell()).status,405);
});
test('Asset read-only caller cannot reach Google or change a row',async()=>{
 const old=globalThis.fetch;let googleCalls=0;globalThis.fetch=async(url)=>{if(url.includes('googleapis'))googleCalls++;return Response.json({});};
 try{const response=await onRequest({env,request:new Request('https://test/api/asset-store/rows',{method:'DELETE',body:'{}'})});assert.equal(response.status,401);assert.equal(googleCalls,0);}finally{globalThis.fetch=old;}
});

test('Asset preserves formula cells while editing a different column',async()=>{
 const {response,calls}=await run('PATCH',{values:['ABC','4']},{formula:true});assert.equal(response.status,200);
 const write=calls.find(c=>c.url.endsWith('/values:batchUpdate'));assert.deepEqual(JSON.parse(write.init.body).data,[{range:"'ASSET A'!B2",values:[[4]]}]);
});
test('caller role headers do not grant Asset write access',async()=>{
 const original=globalThis.fetch;let googleCalls=0;
 globalThis.fetch=async(url)=>{if(url.includes('googleapis'))googleCalls++;if(url.includes('/auth/v1/user'))return Response.json({id:'staff'});return Response.json([{role:'Staff',full_name:'Staff'}]);};
 try{const response=await onRequest({env,request:new Request('https://test/api/asset-store/rows',{method:'POST',headers:{Authorization:'Bearer staff','x-developer-user':'true'},body:'{}'})});assert.equal(response.status,403);assert.equal(googleCalls,0);}finally{globalThis.fetch=original;}
});
