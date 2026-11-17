import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
const start=source.indexOf('async function paginateRows('),code=source.slice(start,source.indexOf('\nfunction ',start+1));
function fixture(mode='in'){
 const state={page:1,pageSize:25,total:100,requestId:0},restored=[],requests=[],snapshot={windowY:700,positions:[{top:320,left:180}]};
 let release,active=mode==='in'?'barang-masuk':'barang-keluar';
 const context=vm.createContext({TABLE_STATE:{[mode]:state},captureActivePageScroll:()=>snapshot,getActivePage:()=>active,restoreActivePageScroll:async(route,value)=>restored.push({route,value}),loadTransactionTablePage:(_mode,options)=>{requests.push(options);state.page=options.page;state.requestId++;return new Promise(resolve=>release=resolve);}});
 vm.runInContext(code,context);
 return {state,restored,requests,snapshot,run:()=>context.paginateRows(mode,'next'),finish:()=>release(),leave(){active='dashboard';}};
}
test('Next preserves viewport and table positions after asynchronous pagination for both transaction pages',async()=>{
 for(const mode of ['in','out']){
  const f=fixture(mode),pending=f.run();
  assert.equal(f.requests[0].background,true);assert.equal(f.requests[0].page,2);assert.equal(f.restored.length,0);
  f.finish();await pending;assert.equal(f.restored.length,1);assert.equal(f.restored[0].value,f.snapshot);
 }
});
test('pagination does not restore an old position after leaving or a newer request',async()=>{
 const left=fixture(),pending=left.run();left.leave();left.finish();await pending;assert.equal(left.restored.length,0);
 const stale=fixture(),old=stale.run();stale.state.requestId++;stale.finish();await old;assert.equal(stale.restored.length,0);
});
