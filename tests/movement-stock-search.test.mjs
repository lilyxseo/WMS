import test from 'node:test';
import assert from 'node:assert/strict';
import {createMovementStockSearch} from '../assets/js/movement-stock-search.js';
import {onRequestGet} from '../functions/api/movement/search.js';
const tick=()=>new Promise(setImmediate);
test('full numeric SKU starts immediately and stale responses cannot replace a newer query',async()=>{
 const calls=[];const search=createMovementStockSearch({delay:10000,fetchFn:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))});search.search('682500001373');assert.equal(calls.length,1);assert.equal(search.state.status,'loading');search.search('682500001374');assert.equal(calls.length,2);assert.equal(calls[0].options.signal.aborted,true);calls[1].resolve(Response.json({success:true,rows:[{sku:'682500001374'}]}));await tick();calls[0].resolve(Response.json({success:true,rows:[{sku:'682500001373'}]}));await tick();assert.equal(search.state.rows[0].sku,'682500001374');search.dispose();
});
test('name searches debounce, clearing input cancels work, failed requests can retry, and dispose suppresses updates',async()=>{
 const calls=[],states=[];const search=createMovementStockSearch({delay:5,onState:state=>states.push(state),fetchFn:async url=>{calls.push(url);return Response.json({success:false},{status:502});}});search.search('GOTO');search.search('TUMBLER');await new Promise(r=>setTimeout(r,20));assert.equal(calls.length,1);assert.match(calls[0],/TUMBLER/);assert.equal(search.state.status,'error');search.search('TUMBLER',{force:true});await new Promise(r=>setTimeout(r,20));assert.equal(calls.length,2);search.search('ABC');search.search('');await new Promise(r=>setTimeout(r,20));assert.equal(calls.length,2);assert.equal(search.state.status,'idle');search.dispose();const count=states.length;search.search('682500001373');await tick();assert.equal(states.length,count);
});
const env={PREVIEW_BYPASS_LOGIN:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
const request=query=>new Request('https://wms.test/api/movement/search?q='+encodeURIComponent(query),{headers:{'x-preview-bypass-login':'true'}});
test('stock lookup requires authentication and validates the query',async()=>{assert.equal((await onRequestGet({request:request('0012'),env:{}})).status,401);assert.equal((await onRequestGet({request:request('a'),env})).status,400);});
test('exact SKU reads only stock matches, keeps locations/leading zero/negative balances and excludes zero',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json([{sku:'0012',nama_barang:'Product',lokasi_bulky:'A',stok_akhir:3},{sku:'0012',nama_barang:'Product',lokasi_bulky:'B',stok_akhir:-2},{sku:'0012',stok_akhir:0}]);};try{const response=await onRequestGet({request:request('0012'),env}),data=await response.json();assert.equal(response.status,200);assert.equal(calls.length,1);assert.match(calls[0].url,/sku=eq.0012/);assert.match(calls[0].url,/stok_akhir=neq.0/);assert.match(calls[0].url,/limit=80/);assert.equal(data.rows.length,2);assert.equal(data.rows[1].stok_akhir,-2);assert.equal(data.rows[0].sku,'0012');assert.equal(data.rows[0].lokasi,'A');}finally{globalThis.fetch=original;}
});
test('missing exact SKU falls back to escaped SKU/name/location matching and source errors stay visible',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async url=>{calls.push(url);return Response.json(calls.length===1?[]:[{sku:'GT-ABC',nama_barang:'Product',lokasi_bulky:'A',stok_akhir:3}]);};try{const response=await onRequestGet({request:request('GT-ABC'),env});assert.equal((await response.json()).rows[0].sku,'GT-ABC');assert.equal(calls.length,2);assert.match(calls[1],/nama_barang.ilike/);globalThis.fetch=async()=>Response.json({message:'Unavailable'},{status:503});assert.equal((await onRequestGet({request:request('0012'),env})).status,502);}finally{globalThis.fetch=original;}
});
