import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {handleInventoryAccuracy} from '../functions/api/inventory-accuracy.js';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
test('dashboard accuracy excludes unknown stock and sends only the summary',async()=>{
 const response=await handleInventoryAccuracy({request:new Request('https://wms.test/api/inventory-accuracy?summary=1'),env:{SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'sb_secret_test'}},{authorize:async()=>true,fetch:async()=>Response.json({ready:true,rows:[{selisih:0},{selisih:0},{selisih:2},{selisih:null}]})});
 const data=await response.json();assert.ok(Math.abs(data.accuracy-200/3)<1e-10);assert.equal(data.rows,undefined);
});
test('unavailable or unmatched comparison cannot appear as zero percent',async()=>{
 for(const [ready,rows] of [[false,[{selisih:0}]],[true,[{selisih:null}]]]){
 const response=await handleInventoryAccuracy({request:new Request('https://wms.test/api/inventory-accuracy?summary=1'),env:{SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'sb_secret_test'}},{authorize:async()=>true,fetch:async()=>Response.json({ready,rows})});assert.equal((await response.json()).accuracy,null);
 }
});
test('accuracy refresh updates only its card and ignores a previous account response',async()=>{
 let resolve;const value={},ctx=vm.createContext({authRequestGeneration:1,AbortSignal,fetchJsonSafe:()=>new Promise(r=>resolve=r),dashboardCards:{querySelector:selector=>selector.endsWith('.v')?value:{setAttribute(){}}}});
 vm.runInContext(source.slice(source.indexOf('let dashboardAccuracyState='),source.indexOf('async function loadDashboardPayload()')),ctx);
 const pending=ctx.loadDashboardAccuracy();resolve({res:{ok:true},data:{success:true,ready:true,accuracy:57.44}});await pending;assert.equal(value.textContent,'57.44%');assert.equal(ctx.dashboardAccuracyCard().name,'Akurasi Stok');
 const stale=ctx.loadDashboardAccuracy();ctx.authRequestGeneration=2;resolve({res:{ok:true},data:{success:true,ready:true,accuracy:100}});await stale;assert.equal(ctx.dashboardAccuracyCard().value,'—');
});
