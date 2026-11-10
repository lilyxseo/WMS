import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {onRequestPost as inbound} from '../functions/api/barang-masuk/bulk-update.js';
import {onRequestPost as outbound} from '../functions/api/barang-keluar/bulk-update.js';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function describeEditableTableCell'),source.indexOf('let editableTablesController;'));
function fixture(fetchFn){
 const row={sku:'0012',rowNumber:2,qty:1,_rawCells:{qty:1,tanggal:'2026-11-10',from:'A',to:'B'}},budgets=[],ack=[];
 const ctx=vm.createContext({authRequestGeneration:1,getAuthHeaders:async()=>({Authorization:'Bearer test'}),fetch:fetchFn,AbortSignal:{timeout(ms){budgets.push(ms);const c=new AbortController();const timer=setTimeout(()=>c.abort(new DOMException('signal timed out','TimeoutError')),ms/1000);timer.unref();return c.signal;}},TypeError,SyntaxError,SKU_DETAIL_EDIT_STATE:{sku:'0012',rows:{in:[row],out:[]},payload:{sources:{'Barang Masuk':[{}]}}},updateLocalRow(){},updateCacheRow(){},TRANSACTION_PAGE_CACHE:{clearSource(){}},transactionSource:()=> 'barang_masuk',DASHBOARD_SUMMARY:{},refreshSkuDetailLedger(){},logActivitySafe(){},syncInventorySourcesForRefresh:async()=>{}});
 vm.runInContext(code,ctx);
 const patch={scope:'sku-detail-in',skuBefore:'0012',rowNumber:2,rowRef:row,field:'qty',before:'1',value:'2',number:true,key:'qty'};
 return {ctx,row,budgets,ack,save:()=>ctx.saveEditableTableChanges('sku-detail-in',[patch],p=>ack.push(p))};
}
test('slow inline save can finish beyond the old 25-second budget and acknowledges only once',async()=>{
 let calls=0;const f=fixture(async(url,options)=>{calls++;return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});setTimeout(()=>resolve({ok:true,json:async()=>({success:true})}),50);});});
 await f.save();assert.deepEqual(f.budgets,[180000]);assert.equal(calls,1);assert.equal(f.row.qty,2);assert.equal(f.ack.length,1);
});
for(const name of ['TimeoutError','AbortError','TypeError','SyntaxError'])test(`${name}: failed/uncertain response retains the draft and does not retry the mutation`,async()=>{
 let calls=0;const f=fixture(async()=>{calls++;if(name==='SyntaxError')return {ok:true,json:async()=>{throw new SyntaxError('invalid JSON');}};if(name==='TypeError')throw new TypeError('Network error');throw new DOMException('signal timed out',name);});
 await assert.rejects(f.save(),error=>/Penyimpanan belum terkonfirmasi/.test(error.message)&&/Draf tetap tersedia/.test(error.message)&&!/signal timed out/.test(error.message));assert.equal(calls,1);assert.equal(f.row.qty,1);assert.equal(f.ack.length,0);
});
test('account changes while checking auth do not send the mutation',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;});f.ctx.getAuthHeaders=async()=>{f.ctx.authRequestGeneration=2;return {};};await assert.rejects(f.save(),/Sesi berubah/);assert.equal(calls,0);
});
for(const handler of [inbound,outbound])test('ledger reuses only the server audit token and still verifies the original row',async()=>{
 const original=globalThis.fetch;let oauth=0,reads=0,writes=0;globalThis.fetch=async(url,options={})=>{if(url.includes('app-google-auth')){oauth++;throw Error('Should reuse audit token');}assert.equal(options.headers.Authorization,'Bearer trusted-audit-token');if(url.includes('batchUpdate')){writes++;return Response.json({totalUpdatedCells:1});}reads++;return Response.json({values:[['2026-11-10','A','B','0012','Product',1]]});};
 try{const response=await handler({env:{PREVIEW_BYPASS_LOGIN:'true',SHEET_ID_2026:'ledger'},data:{operationSnapshot:{token:'trusted-audit-token'}},request:new Request('https://wms.test/api/update',{method:'POST',headers:{'x-preview-bypass-login':'true','Content-Type':'application/json'},body:JSON.stringify({rowNumbers:[2],updates:{qty:2},expectedRows:{2:{sku:'0012',cells:{qty:1}}},accessToken:'untrusted-request-token'})})});assert.equal(response.status,200);assert.equal(oauth,0);assert.equal(reads,1);assert.equal(writes,1);}finally{globalThis.fetch=original;}
});
