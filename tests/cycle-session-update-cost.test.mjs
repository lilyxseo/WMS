import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function applyMovementDraftChanges('),source.indexOf('function editableTableActionScope('));
test('large Cycle Count drafts update only changed rows and avoid rewriting identical status cells',()=>{
 const items=Array.from({length:1000},()=>({aktual:10,stok:10,catatan:''}));let writes=0,persisted=0;const touched=[];
 const cell=value=>({get textContent(){return value;},set textContent(next){writes++;value=next;},get innerHTML(){return value;},set innerHTML(next){writes++;value=next;}});
 const cells=new Map([[25,{diff:cell('0'),status:cell('<span>Sesuai</span>')}],[700,{diff:cell('0'),status:cell('<span>Sesuai</span>')}]]);
 const ctx=vm.createContext({CYCLE_STATE:{sessionActive:true,sessionItems:items},canCrud:()=>true,persistInventoryDraft:()=>persisted++,canSubmitCycle:()=>true,cycleDiffBadge:row=>row.aktual===row.stok?'<span>Sesuai</span>':'<span>Ada Selisih</span>',document:{getElementById:()=>null,querySelector:selector=>{const index=Number(selector.match(/data-idx='(\d+)'/)[1]);touched.push(index);return {querySelector:selector=>selector.includes('diff')?cells.get(index).diff:cells.get(index).status};}}});vm.runInContext(code,ctx);
 ctx.applyMovementDraftChanges('cycle-session',[{target:{rowRef:items[25],field:'aktual',number:true},value:'0'},{target:{rowRef:items[25],field:'catatan'},value:'Hitung ulang'},{target:{rowRef:items[700],field:'catatan'},value:'Sesuai'}]);assert.deepEqual(touched,[25,700]);assert.equal(writes,2);assert.equal(items[25].aktual,0);assert.equal(items[25].catatan,'Hitung ulang');assert.equal(cells.get(25).diff.textContent,'-10');assert.equal(persisted,1);
});
