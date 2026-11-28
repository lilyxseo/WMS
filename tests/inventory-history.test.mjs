import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInventoryHistory} from '../functions/api/inventory-history.js';

const context=query=>({
 request:new Request(`https://example.test/api/inventory-history${query}`),
 env:{SHEET_ID_2026:'A'.repeat(32)}
});
const auth={authorize:async()=>true,getToken:async()=>'mock-google-token'};
const xlsx='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('inventory history requires authentication and validates dates and dataset',async()=>{
 const unexpected=async()=>assert.fail('Invalid requests must not read inventory');
 assert.equal((await handleInventoryHistory(context(''),{authorize:async()=>false,getToken:unexpected})).status,401);
 for(const query of ['?date=9999-01-01','?date=2026-02-29','?date=0000-01-01','?kind=current']){
  const response=await handleInventoryHistory(context(query),{authorize:async()=>true,getToken:unexpected});
  assert.equal(response.status,400);
 }
});

test('history selects the latest revision before midnight WIB and downloads only its export',async()=>{
 let calls=0;
 const response=await handleInventoryHistory(context('?date=2026-11-25&kind=outbound&q=0012&page=3'),{
  ...auth,fetchFn:async(input,options)=>{
   const url=new URL(input);calls++;
   if(url.pathname.endsWith('/revisions')){
    if(!url.searchParams.has('pageToken'))return Response.json({nextPageToken:'next',revisions:[
     {id:'too-new',modifiedTime:'2026-11-25T17:00:00Z'},{id:'older',modifiedTime:'2026-11-25T10:00:00Z'}]});
    return Response.json({revisions:[{id:'chosen',modifiedTime:'2026-11-25T16:59:59Z'}]});
   }
   if(url.pathname.endsWith('/revisions/chosen'))return Response.json({exportLinks:{[xlsx]:'https://docs.google.com/spreadsheets/export?revision=chosen'}});
   if(url.hostname==='docs.google.com')return new Response(null,{status:302,headers:{location:'https://download.googleusercontent.com/file'}});
   assert.equal(url.hostname,'download.googleusercontent.com');
   assert.equal(options.headers,undefined);
   return new Response(new Uint8Array([1,2,3]));
  },
  readWorkbook:async(bytes,opts)=>{
   assert.equal(bytes.byteLength,3);
   assert.deepEqual(opts,{kind:'outbound',query:'0012',page:3});
   return {rows:[{sku:'0012'}],total:110,sheet:'Barang Keluar'};
  }
 });
 const data=await response.json();
 assert.equal(response.status,200);
 assert.equal(calls,5);
 assert.equal(data.revisionAt,'2026-11-25T16:59:59Z');
 assert.equal(data.rows[0].sku,'0012');
 assert.equal(data.page,3);
});

test('when an old revision cannot be exported the endpoint returns unavailable without reading current Sheets',async()=>{
 const urls=[];
 const response=await handleInventoryHistory(context('?date=2026-11-25'),{
  ...auth,fetchFn:async input=>{
   const url=new URL(input);urls.push(url.pathname);
   return Response.json(url.pathname.endsWith('/revisions')?{revisions:[{id:'old',modifiedTime:'2026-11-24T12:00:00Z'}]}:{id:'old'});
  }
 });
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.revisionUnavailable,true);
 assert.match(data.message,/ekspor XLSX/);
 assert.equal(urls.length,2);
});
