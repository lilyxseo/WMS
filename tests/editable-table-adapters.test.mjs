import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../assets/js/main.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],ack=[],inbound={rowNumber:2,qty:1,sku:'SKU1',_rawCells:{qty:1,sku:'SKU1'}},asset={__rowNumber:2,SKU:'SKU1',Qty:1};
 const ctx=vm.createContext({AbortSignal,canCrud:()=>true,authRequestGeneration:1,TABLE_STATE:{in:{rows:[inbound]}},ASSET_STORE_STATE:{cache:{ASSET:{columns:['SKU','Qty'],rows:[asset]}}},window:{BALIKAN_ROWS:[{rowNumber:2,sheetName:'TRIP',qty:1,lokasi:'A1'}]},getBalikanActiveSheetName:row=>row.sheetName,MOVEMENT_HISTORY_REMOTE:{rows:[{rowNumber:2,sku:'SKU1',tanggal:'2026-10-19',stok_lokasi_awal:10,stok_aktual:2}]},CYCLE_HISTORY_REMOTE:{rows:[{rowNumber:2,sku:'SKU1',aktual:2}]},CYCLE_STATE:{sessionItems:[{sku:'SKU1',lokasi:'A1',aktual:0}],submitting:false},MOVEMENT_STATE:{sessionItems:[{sku:'SKU1',lokasi:'A1',stokAktual:0}],submitting:false},PDF_TRANSFER_STATE:{items:[{sku:'SKU1',qty:0}],isImporting:false},normalizeMovementDate:v=>v,isValidMovementDate:v=>/^\d{4}-\d{2}-\d{2}$/.test(v),getAuthHeaders:async()=>({Authorization:'Bearer test'}),fetch:async(path,init)=>{calls.push({path,method:init.method,body:JSON.parse(init.body)});return {ok:true,json:async()=>({success:true,failed:[]})};},updateLocalRow(){},updateCacheRow(){},transactionSource:()=> 'barang_masuk',TRANSACTION_PAGE_CACHE:{clearSource(){}},DASHBOARD_SUMMARY:{},logActivitySafe(){},HISTORY_EDIT_STATE:{movement:{},cycle:{}},renderCycleSessionTable(){},renderMovementSessionTable(){},renderImportPdfTransferPage(){},renderMovementHistory(){},renderCycleHistory(){},updateBalikanLocalRow(){},getBalikanVisibleRows:()=>({rows:[],baseRows:[]}),renderBalikanSummaryInfo(){}});
 vm.runInContext(source.slice(source.indexOf('function describeEditableTableCell'),source.indexOf('let editableTablesController;')),ctx);
 const cell=(dataset,attrs=[],input=null)=>({dataset,closest:()=>null,querySelector:()=>input,hasAttribute:name=>attrs.includes(name),isContentEditable:attrs.includes('data-pdf-item')});
 const patch=(cell,value)=>({...ctx.describeEditableTableCell(cell),before:String(ctx.describeEditableTableCell(cell).value),value});
 return {ctx,calls,ack,cell,patch,inbound,asset,save:(scope,patches)=>ctx.saveEditableTableChanges(scope,patches,p=>ack.push(p.key))};
}
test('transaction grid groups a row update and acknowledges only after successful API response',async()=>{
 const f=fixture(),patches=[f.patch(f.cell({mvCell:'1',mode:'in',row:'2',field:'qty'}),'4'),f.patch(f.cell({mvCell:'1',mode:'in',row:'2',field:'sku'}),'SKU2')];await f.save('transaction-in',patches);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/barang-masuk/bulk-update');assert.equal(f.calls[0].body.updates.qty,4);assert.equal(f.inbound._rawCells.sku,'SKU2');assert.equal(f.ack.length,2);
});
test('Asset grid retains expected-row protection and rejects a changed local source',async()=>{
 const f=fixture(),patch=f.patch(f.cell({sheet:'ASSET',row:'2',field:'Qty'},['data-asset-cell']),'5');await f.save('asset',[patch]);assert.deepEqual(f.calls[0].body.expected,['SKU1','1']);assert.deepEqual(f.calls[0].body.values,['SKU1','5']);
 const stale=f.patch(f.cell({sheet:'ASSET',row:'2',field:'Qty'},['data-asset-cell']),'6');f.asset.Qty=7;await assert.rejects(f.save('asset',[stale]),/Data Asset berubah/);assert.equal(f.calls.length,1);
});
test('Movement history protects SKU and maps stock fields to existing API names',async()=>{
 const f=fixture();assert.equal(f.ctx.describeEditableTableCell(f.cell({mvhField:'sku',row:'2'})),null);const patch=f.patch(f.cell({mvhField:'stok_aktual',row:'2'}),'3');await f.save('movement-history',[patch]);assert.equal(f.calls[0].method,'PATCH');assert.equal(f.calls[0].body.field,'stokAktual');assert.equal(f.calls[0].body.value,3);
});
test('session edits are local and never send inventory transactions',async()=>{
 const f=fixture(),patch=f.patch(f.cell({},[],{dataset:{cc:'aktual',idx:'0'}}),'9');await f.save('cycle-session',[patch]);assert.equal(f.calls.length,0);assert.equal(f.ctx.CYCLE_STATE.sessionItems[0].aktual,9);assert.equal(f.ack.length,1);
 const moved=f.patch(f.cell({},[],{dataset:{mvm:'akt',idx:'0'}}),'4');f.ctx.MOVEMENT_STATE.sessionItems=[];await assert.rejects(f.save('movement-session',[moved]),/Baris sesi berubah/);assert.equal(f.calls.length,0);
});
test('failed API writes remain unacknowledged and do not change source values',async()=>{
 const f=fixture(),patch=f.patch(f.cell({mvCell:'1',mode:'in',row:'2',field:'qty'}),'7');f.ctx.fetch=async()=>({ok:false,json:async()=>({success:false,message:'Rejected'})});await assert.rejects(f.save('transaction-in',[patch]),/Rejected/);assert.equal(f.ack.length,0);assert.equal(f.inbound.qty,1);
});
test('invalid numeric values and formulas stay protected',()=>{
 const f=fixture(),cell=f.cell({mvCell:'1',mode:'in',row:'2',field:'qty'}),desc=f.ctx.describeEditableTableCell(cell);assert.throws(()=>desc.validate('-1'),/nol atau positif/);assert.throws(()=>desc.validate('=1+1'),/Rumus/);
});

test('SKU detail edits retain source row references and submit optimistic checks through existing ledger API',async()=>{
 const f=fixture();f.ctx.SKU_DETAIL_EDIT_STATE={sku:'SKU1',rows:{in:[f.inbound],out:[]},payload:{sources:{'Barang Masuk':[f.inbound]}}};f.ctx.refreshSkuDetailLedger=()=>{};f.ctx.syncInventorySourcesForRefresh=async()=>({success:true});
 const patch=f.patch(f.cell({detailLedger:'in',row:'2',field:'qty'}),'6');await f.save('sku-detail-in',[patch]);
 assert.equal(f.calls[0].path,'/api/barang-masuk/bulk-update');assert.equal(f.calls[0].body.expectedRows['2'].sku,'SKU1');assert.equal(f.calls[0].body.expectedRows['2'].cells.qty,'1');assert.equal(f.inbound.qty,6);assert.equal(f.ack.length,1);
});
test('SKU detail cannot save a draft after navigation replaced its source rows',async()=>{
 const f=fixture();f.ctx.SKU_DETAIL_EDIT_STATE={sku:'SKU1',rows:{in:[f.inbound],out:[]}};const patch=f.patch(f.cell({detailLedger:'in',row:'2',field:'qty'}),'8');f.ctx.SKU_DETAIL_EDIT_STATE.rows.in=[];await assert.rejects(f.save('sku-detail-in',[patch]),/Detail SKU berubah/);assert.equal(f.calls.length,0);
});
test('Movement draft edits apply and persist immediately without a transaction request',()=>{
 const f=fixture();vm.runInContext(source.slice(source.indexOf('function applyMovementDraftChanges'),source.indexOf('function editableTableActionScope')),f.ctx);f.ctx.MOVEMENT_STATE.sessionActive=true;let persisted=0;f.ctx.persistInventoryDraft=()=>{persisted++;return true;};f.ctx.document={getElementById:()=>null};const target=f.ctx.describeEditableTableCell(f.cell({},[],{dataset:{mvm:'akt',idx:'0'}}));f.ctx.applyMovementDraftChanges('movement-session',[{target,value:'400'}]);assert.equal(f.ctx.MOVEMENT_STATE.sessionItems[0].stokAktual,400);assert.equal(persisted,1);assert.equal(f.calls.length,0);
});
test('Movement retains typed edits when local persistence fails so account saving can recover them',()=>{
 const f=fixture();vm.runInContext(source.slice(source.indexOf('function applyMovementDraftChanges'),source.indexOf('function editableTableActionScope')),f.ctx);f.ctx.MOVEMENT_STATE.sessionActive=true;f.ctx.persistInventoryDraft=()=>false;f.ctx.document={getElementById:()=>null};const target=f.ctx.describeEditableTableCell(f.cell({},[],{dataset:{mvm:'akt',idx:'0'}}));assert.doesNotThrow(()=>f.ctx.applyMovementDraftChanges('movement-session',[{target,value:'400'}]));assert.equal(f.ctx.MOVEMENT_STATE.sessionItems[0].stokAktual,400);assert.equal(f.calls.length,0);
});
