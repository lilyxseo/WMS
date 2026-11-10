import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let skuDetailWorkflowPending='),source.indexOf('const SKU_DETAIL_EDIT_STATE='));
function fixture({active=false,allowed=true,delivery='editing',cloudStatus='saved',ready=Promise.resolve()}={}){
 const state={sessionActive:active,sessionItems:active?[{sku:'OLD',lokasi:'A01-1',to:'B01-1',stokAktual:2}]:[],searchInput:'previous',search:'previous',tanggal:'2026-10-01',delivery,submitting:false};
 const calls=[],cloud={ready,state:{status:cloudStatus,message:'Resolve draft'}};
 const ctx=vm.createContext({currentSku:'0012',authRequestGeneration:1,SKU_DETAIL_EDIT_STATE:{sku:'0012'},getActivePage:()=> 'detail',getPermissions:()=>({canCreate:allowed}),toast:(...args)=>calls.push(['toast',...args]),restoreInventoryDraft:kind=>calls.push(['restore',kind]),accountInventoryDraft:()=>cloud,inventoryDraftState:()=>state,prepareInventorySession:kind=>{calls.push(['prepare',kind]);return true;},formatInputDate:()=> '2026-11-10',persistInventoryDraft:kind=>calls.push(['persist',kind]),navigateTo:path=>calls.push(['navigate',path]),clearTimeout,Date,document:{addEventListener(){}}});
 vm.runInContext(code,ctx);return {ctx,state,calls,cloud};
}
for(const kind of ['movement','cycle-count']){
 test(`${kind}: detail action starts a draft with the exact SKU search and no transaction submission`,async()=>{
  const f=fixture(),button={disabled:false};await f.ctx.openSkuWorkflow(kind,button);assert.equal(f.state.sessionActive,true);assert.equal(f.state.searchInput,'0012');assert.equal(f.state.search,'0012');assert.equal(f.state.sessionItems.length,0);assert.equal(button.disabled,false);assert.ok(f.calls.some(call=>call[0]==='navigate'&&call[1]==='/'+kind));assert.equal(f.calls.filter(call=>call[0]==='prepare').length,1);if(kind==='cycle-count')assert.equal(f.state.tanggal,'2026-11-10');
 });
 test(`${kind}: existing draft keeps all items and the selected date`,async()=>{
  const f=fixture({active:true}),items=f.state.sessionItems;await f.ctx.openSkuWorkflow(kind);assert.equal(f.state.sessionItems,items);assert.equal(f.state.sessionItems[0].sku,'OLD');assert.equal(f.state.tanggal,'2026-10-01');assert.equal(f.calls.filter(call=>call[0]==='prepare').length,0);assert.equal(f.state.searchInput,'0012');
 });
}
test('read-only users neither see action buttons nor start a workflow',async()=>{const f=fixture({allowed:false});assert.equal(f.ctx.renderSkuWorkflowActions(),'');await f.ctx.openSkuWorkflow('movement');assert.equal(f.state.sessionActive,false);assert.ok(!f.calls.some(call=>call[0]==='navigate'));});
test('actions await account draft restore, ignore stale account/navigation, and prevent duplicate starts',async()=>{
 let resolve;const ready=new Promise(r=>resolve=r),f=fixture({ready});const pending=f.ctx.openSkuWorkflow('movement');await f.ctx.openSkuWorkflow('movement');assert.equal(f.calls.filter(call=>call[0]==='prepare').length,0);f.ctx.authRequestGeneration=2;resolve();await pending;assert.equal(f.state.sessionActive,false);assert.ok(!f.calls.some(call=>call[0]==='navigate'));
});
test('uncertain delivery and draft conflicts navigate to the existing draft without replacing it',async()=>{
 for(const options of [{active:true,delivery:'uncertain'},{active:true,cloudStatus:'conflict'},{cloudStatus:'error'}]){
  const f=fixture(options),before=JSON.stringify(f.state);await f.ctx.openSkuWorkflow('movement');assert.equal(JSON.stringify(f.state),before);assert.ok(f.calls.some(call=>call[0]==='navigate'));assert.ok(!f.calls.some(call=>call[0]==='persist'||call[0]==='prepare'));
 }
});
test('both buttons are mounted in the Detail SKU layout',()=>{
 const f=fixture();const markup=f.ctx.renderSkuWorkflowActions();assert.match(markup,/Buat Movement/);assert.match(markup,/Buat Cycle Count/);assert.match(source,/html\+=renderSkuWorkflowActions\(\)/);
});
