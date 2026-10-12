import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../assets/js/main.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const INVENTORY_DRAFT_OWNERS='),source.indexOf('const CYCLE_STATE='));
const line=prefix=>source.split('\n').find(s=>s.startsWith(prefix));
function fixture(storage=new Map()){
 const state=()=>({sessionActive:false,sessionItems:[],searchInput:'',submitting:false});
 const calls=[],messages=[];let modal;
 const ctx=vm.createContext({user:{id:'alice'},authRequestGeneration:1,devProfile:null,getCurrentUser:()=>({email:'alice@example.com'}),CYCLE_STATE:state(),MOVEMENT_STATE:state(),MOVEMENT_HISTORY_REMOTE:{loaded:true},crypto:{randomUUID:()=> 'draft-1'},clearTimeout,Date,console,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{getElementById:id=>id==='confirmModalRoot'?{}:null,querySelectorAll:()=>[]},toast:(...args)=>messages.push(args),esc:x=>String(x).replaceAll('<','&lt;'),getPermissions:()=>({canCreate:true}),canSubmitCycle:()=>true,canSubmitMovement:()=>true,showConfirmModal:options=>{modal=options;},renderCycleSessionTable(){},renderMovementSessionTable(){},renderCycleCountPage(){},renderMovementPage(){},formatTanggal:x=>String(x),getCurrentUserRole:()=> 'inventory',normalizeRole:x=>x,APP_CONFIG:{PIC_BY_ROLE:{inventory:'PIC'}},clean:x=>String(x),logActivitySafe(){},loadCycleCountHistory:async()=>{},ensureMovementHistoryLoaded:async()=>{},syncData:async()=>{},refreshMovementTotal:async()=>{},fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({success:true})};},window:{}});
 vm.runInContext(helpers+'\n'+line('async function sendCycleSession()')+'\n'+line('async function sendMovementSession()')+'\n'+line('window.ccSubmitSession=')+'\n'+line('window.mvSubmitSession='),ctx);
 return {ctx,storage,calls,messages,get modal(){return modal;}};
}
function seed(f,kind){const c=f.ctx;c.prepareInventorySession(kind);const s=c.inventoryDraftState(kind);Object.assign(s,{sessionActive:true,searchInput:'merlyn',tanggal:'2026-10-12',sessionItems:[kind==='cycle-count'?{sku:'8844',nama:'Merlyn',lokasi:'A20-1',stok:6,aktual:0,catatan:'Hitung ulang'}:{sku:'8844',nama:'Merlyn',lokasi:'A20-1',stokAwal:6,stokAktual:2,to:'B20-1'}]});c.persistInventoryDraft(kind);return s;}
for(const kind of ['cycle-count','movement']){
 test(`${kind}: reload restores inputs and data refresh preserves newer edits`,()=>{
  const f=fixture();seed(f,kind);const copy=JSON.parse(JSON.stringify(f.ctx.inventoryDraftState(kind).sessionItems));const g=fixture(f.storage);g.ctx.restoreInventoryDraft(kind);const s=g.ctx.inventoryDraftState(kind);assert.equal(s.sessionActive,true);assert.deepEqual(JSON.parse(JSON.stringify(s.sessionItems)),copy);assert.equal(s.searchInput,'merlyn');if(kind==='cycle-count')assert.equal(s.tanggal,'2026-10-12');s.searchInput='new query';g.ctx.restoreInventoryDraft(kind);assert.equal(s.searchInput,'new query');
 });
 test(`${kind}: confirmation required; successful submission clears the draft`,async()=>{
  const f=fixture();seed(f,kind);f.ctx.window[kind==='cycle-count'?'ccSubmitSession':'mvSubmitSession']();assert.equal(f.calls.length,0);assert.equal(f.modal.confirmText,'Kirim Data');assert.match(f.modal.message,/8844/);await f.modal.onConfirm();assert.equal(f.calls.length,1);assert.equal(f.ctx.inventoryDraftState(kind).sessionActive,false);assert.equal(f.storage.size,0);if(kind==='cycle-count')assert.equal(f.calls[0].body.items[0].aktual,0);else assert.equal(f.calls[0].body.items[0].to,'B20-1');
 });
 test(`${kind}: failed POST retains draft; reload warns instead of automatically retrying`,async()=>{
  const f=fixture();seed(f,kind);f.ctx.fetch=async()=>{throw new Error('Offline');};f.ctx.reviewInventorySession(kind);await f.modal.onConfirm();assert.equal(f.ctx.inventoryDraftState(kind).delivery,'uncertain');const g=fixture(f.storage);g.ctx.restoreInventoryDraft(kind);assert.equal(g.ctx.inventoryDraftState(kind).delivery,'uncertain');assert.equal(g.ctx.inventoryDraftState(kind).submitting,false);assert.equal(g.calls.length,0);assert.match(g.ctx.inventoryDraftMessage(kind),/History/);
 });
 test(`${kind}: double confirmation while pending makes one POST`,async()=>{
  const f=fixture();seed(f,kind);let resolve;f.ctx.fetch=async()=>{f.calls.push('POST');return new Promise(r=>resolve=r);};f.ctx.reviewInventorySession(kind);const pending=f.modal.onConfirm();await f.modal.onConfirm();assert.equal(f.calls.length,1);const g=fixture(f.storage);g.ctx.restoreInventoryDraft(kind);assert.equal(g.ctx.inventoryDraftState(kind).delivery,'uncertain');resolve({ok:true,json:async()=>({success:true})});await pending;
 });
 test(`${kind}: changed draft blocks confirmation and refresh failure never restores saved items`,async()=>{
  const f=fixture();const s=seed(f,kind);f.ctx.reviewInventorySession(kind);s.sessionItems[0].nama='Changed';await f.modal.onConfirm();assert.equal(f.calls.length,0);f.ctx.reviewInventorySession(kind);f.ctx.syncData=async()=>{throw new Error('Refresh failed');};await f.modal.onConfirm();assert.equal(f.calls.length,1);assert.equal(f.storage.size,0);assert.equal(s.sessionActive,false);
 });
}
test('drafts are isolated by account and restore on returning to that account',()=>{const f=fixture();seed(f,'movement');f.ctx.user={id:'bob'};f.ctx.restoreInventoryDraft('movement');assert.equal(f.ctx.MOVEMENT_STATE.sessionActive,false);f.ctx.user={id:'alice'};f.ctx.restoreInventoryDraft('movement');assert.equal(f.ctx.MOVEMENT_STATE.sessionItems[0].sku,'8844');});
test('malformed storage and quota errors do not crash or claim a saved draft',()=>{const f=fixture();f.storage.set(f.ctx.inventoryDraftKey('movement'),'{invalid');assert.doesNotThrow(()=>f.ctx.restoreInventoryDraft('movement'));seed(f,'movement');f.ctx.localStorage.setItem=()=>{throw new Error('Quota');};assert.equal(f.ctx.persistInventoryDraft('movement'),false);assert.match(f.ctx.inventoryDraftMessage('movement'),/belum tersimpan/);});
test('snapshots whitelist business fields and preserve blank actual separately from zero',()=>{const f=fixture();const s=seed(f,'cycle-count');s.sessionItems[0].token='secret';s.sessionItems[0].aktual=null;f.ctx.persistInventoryDraft('cycle-count');const data=JSON.parse([...f.storage.values()][0]);assert.equal(data.items[0].aktual,null);assert.equal(Object.hasOwn(data.items[0],'token'),false);const g=fixture(f.storage);g.ctx.restoreInventoryDraft('cycle-count');assert.equal(g.ctx.CYCLE_STATE.sessionItems[0].aktual,null);});
test('completion of another account request does not clear current account session',()=>{const f=fixture();seed(f,'movement');const op=f.ctx.beginInventorySending('movement');f.ctx.user={id:'bob'};f.ctx.restoreInventoryDraft('movement');seed(f,'movement');assert.equal(f.ctx.finishInventorySession('movement',op),false);assert.equal(f.ctx.MOVEMENT_STATE.sessionActive,true);assert.equal(f.storage.size,1);});

test('missing confirmation dialog cannot send automatically',()=>{const f=fixture();seed(f,'movement');f.ctx.document.getElementById=()=>null;f.ctx.reviewInventorySession('movement');assert.equal(f.modal,undefined);assert.equal(f.calls.length,0);assert.equal(f.storage.size,1);});
test('movement suggestions add to the existing draft and persist their destination',()=>{const f=fixture();seed(f,'movement');f.ctx.computeMovementSuggestions=()=>({rows:[{sku:'2299',fromLokasi:'A10-1',toLokasi:'B10-1',qtyMove:2}]});f.ctx.getMovementSourceRows=()=>[{sku:'2299',nama:'Other',lokasi:'A10-1',stok_akhir:2}];vm.runInContext(line('function addMovementItem(')+'\n'+line('function fillMovementFromSuggestion('),f.ctx);f.ctx.fillMovementFromSuggestion(0);assert.equal(f.ctx.MOVEMENT_STATE.sessionItems.length,2);assert.equal(f.ctx.MOVEMENT_STATE.sessionItems[0].sku,'8844');const g=fixture(f.storage);g.ctx.restoreInventoryDraft('movement');assert.equal(g.ctx.MOVEMENT_STATE.sessionItems[1].to,'B10-1');});
for(const kind of ['cycle-count','movement'])test(`${kind}: input handlers autosave zero, blank quantities, and text immediately`,()=>{
 const f=fixture();seed(f,kind);let handler;f.ctx.document.addEventListener=(type,callback)=>{handler=callback;};const prefix=kind==='cycle-count'?"document.addEventListener('input',e=>{if(CYCLE_STATE.submitting":"document.addEventListener('input',e=>{if(MOVEMENT_STATE.submitting";vm.runInContext(line(prefix),f.ctx);
 const quantity=kind==='cycle-count'?'aktual':'akt',text=kind==='cycle-count'?'ct':'to',datasetKey=kind==='cycle-count'?'cc':'mvm';
 const input=(field,value)=>handler({target:{value,dataset:{[datasetKey]:field,idx:'0'},closest:()=>null}});
 input(quantity,'0');let record=JSON.parse([...f.storage.values()][0]);assert.equal(record.items[0][kind==='cycle-count'?'aktual':'stokAktual'],0);
 input(quantity,'');record=JSON.parse([...f.storage.values()][0]);assert.equal(record.items[0][kind==='cycle-count'?'aktual':'stokAktual'],null);
 input(text,'new text');record=JSON.parse([...f.storage.values()][0]);assert.equal(record.items[0][kind==='cycle-count'?'catatan':'to'],'new text');
});
