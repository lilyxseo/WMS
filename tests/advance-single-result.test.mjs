import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../assets/js/advance-search.js',import.meta.url),'utf8');
const search=source.slice(source.indexOf(' async function search(event){'),source.indexOf('\n const profileClick='));
function fixture(rows){
 const results={innerHTML:'',replaceChildren(){this.innerHTML='';}},profile={replaceChildren(){}},selected=[];
 let current=true;
 const context=vm.createContext({
  root:{querySelector:()=>({value:'product'})},history:{add(){}},renderHistory(){},
  alive:()=>current,el:name=>name==='results'?results:profile,
  request:async()=>({rows}),select:async sku=>selected.push(sku),
  URLSearchParams,esc:value=>String(value),skuNames:new Map(),key:value=>String(value).trim().toUpperCase(),
 });
 vm.runInContext("let searchVersion=0,selectedSku='',version=0,abort=null,notes=null,photo=null;"+search,context);
 return {run:()=>context.search(),results,selected,leave(){current=false;}};
}
test('Advance Search opens the sole SKU automatically and preserves leading zeros',async()=>{
 const f=fixture([{sku:'0012',nama:'Product'}]);await f.run();
 assert.deepEqual(f.selected,['0012']);assert.equal(f.results.innerHTML,'');
});
test('multiple results remain selectable and empty results retain exact-SKU fallback',async()=>{
 const multiple=fixture([{sku:'0012'},{sku:'0013'}]);await multiple.run();
 assert.deepEqual(multiple.selected,[]);assert.match(multiple.results.innerHTML,/Lihat riwayat/);
 const empty=fixture([]);await empty.run();assert.deepEqual(empty.selected,[]);
 assert.match(empty.results.innerHTML,/Buka SKU persis/);
});
test('a result arriving after leaving Advance Search does not open a SKU',async()=>{
 const f=fixture([{sku:'0012'}]),pending=f.run();f.leave();await pending;
 assert.deepEqual(f.selected,[]);
});
