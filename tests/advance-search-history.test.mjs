import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet as cycle} from '../functions/api/cycle-count.js';
import {onRequestGet as movement} from '../functions/api/movement.js';
import {handleInventoryAccuracy} from '../functions/api/inventory-accuracy.js';
const env={PREVIEW_BYPASS_LOGIN:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SHEET_ID_INVENTORY:'test-sheet'};
const request=path=>new Request('https://wms.example'+path,{headers:{'x-preview-bypass-login':'true'}});
test('Cycle Count filters exact SKU before pagination, retaining history past the first page',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).includes('app-google-auth')?Response.json({access_token:'test'}):Response.json({values:Array.from({length:120},(_,i)=>['03/11/2026','A01-1',i%2?'0012':'12','Product',4,3,String(i)])});
 try{const response=await cycle({request:request('/api/cycle-count?sku=0012&page=2&limit=50'),env});assert.equal(response.status,200);const data=await response.json();assert.equal(data.total,60);assert.equal(data.rows.length,10);assert.ok(data.rows.every(row=>row.sku==='0012'));assert.equal(new Set(data.rows.map(row=>row.rowNumber)).size,10);}finally{globalThis.fetch=original;}
});
test('Movement SKU reads require a session and preserve full exact-SKU history',async()=>{
 assert.equal((await movement({request:request('/api/movement?sku=0012'),env:{}})).status,401);
 const original=globalThis.fetch;globalThis.fetch=async url=>String(url).includes('app-google-auth')?Response.json({access_token:'test'}):Response.json({values:[['Tanggal','From','To','SKU','Nama Barang','Qty'],['2026-11-03','A01-1','B01-1','0012','Product',2],['2026-11-03','A01-1','C01-1','12','Other',3]]});
 try{const response=await movement({request:request('/api/movement?sku=0012'),env});assert.equal(response.status,200);const data=await response.json();assert.equal(data.data.length,1);assert.equal(data.data[0].sku,'0012');assert.equal(data.data[0].rowNumber,2);}finally{globalThis.fetch=original;}
});
test('accuracy detail filters SKU strings without changing global accuracy summary',async()=>{
 const dependencies={authorize:async()=>true,fetch:async()=>Response.json({ready:true,rows:[{sku:'0012',selisih:0},{sku:'12',selisih:1}]})};
 const response=await handleInventoryAccuracy({request:request('/api/inventory-accuracy?sku=0012'),env},dependencies);assert.deepEqual((await response.json()).rows,[{sku:'0012',selisih:0}]);
 const summary=await handleInventoryAccuracy({request:request('/api/inventory-accuracy?summary=1'),env},dependencies);assert.equal((await summary.json()).accuracy,50);
});
