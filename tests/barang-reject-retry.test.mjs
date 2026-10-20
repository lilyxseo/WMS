import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
function fn(name){return source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));}
test('failed Reject read stops after one request, keeps error, and permits explicit retry',async()=>{
 let requests=0,toasts=0;
 const context=vm.createContext({
  BARANG_REJECT_STATE:{stock:[],masuk:[],keluar:[],error:''},isBarangRejectLoading:false,lastBarangRejectFetchAt:0,
  authRequestGeneration:1,Date,queueMicrotask,getBarangRejectCache:()=>null,isBarangRejectCacheFresh:()=>false,
  getActivePage:()=> 'dashboard',document:{getElementById:()=>{throw Error('Hidden page rendered');}},
  fetch:async()=>{requests++;return {ok:false,json:async()=>({message:'Refresh token ditolak'})};},
  logActivitySafe:()=>{},isBarangRejectQuotaError:()=>false,toast:()=>toasts++
 });
 vm.runInContext([fn('loadBarangRejectData'),fn('ensureBarangRejectLoaded'),fn('renderBarangRejectPage')].join('\n'),context);
 await vm.runInContext('loadBarangRejectData()',context);
 vm.runInContext('ensureBarangRejectLoaded()',context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,1);assert.equal(toasts,1);
 assert.equal(context.BARANG_REJECT_STATE.error,'Refresh token ditolak');
 await vm.runInContext('loadBarangRejectData({force:true})',context);
 assert.equal(requests,2);
});
test('rendering Reject cannot schedule network requests',()=>{
 assert.doesNotMatch(fn('renderBarangRejectPage'),/ensureBarangRejectLoaded|queueMicrotask|fetch\(/);
 assert.match(source,/if\(page==="barang-reject"\)\{ensureBarangRejectLoaded\(\);renderBarangRejectPage\(\);return;\}/);
});

test('Refresh binds one handler across repeated renders',()=>{
 assert.match(fn('bindBarangRejectEvents'),/refreshBtn\.onclick=/);
 assert.doesNotMatch(fn('bindBarangRejectEvents'),/refreshBtn\.addEventListener/);
});
