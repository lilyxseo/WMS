import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fetchLastInboundLocations} from '../functions/api/balikan-store/_last-inbound-location.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
async function withRows(rows,callback){
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async input=>{const url=new URL(input);requests.push(url);const offset=Number(url.searchParams.get('offset'));return new Response(JSON.stringify(rows.slice(offset,offset+1000)),{headers:{'content-range':`${offset}-${Math.min(rows.length,offset+1000)-1}/${rows.length}`}});};
 try{await callback(requests);}finally{globalThis.fetch=original;}
}
test('last inbound location uses normalized chronology, exact SKU and same-day row tie-break',async()=>{
 await withRows([
  {sku:'001',to_location:'Old',tanggal:'12/31/2025',source_row_number:900},
  {sku:'001',to_location:'A10-1',tanggal:'2026-10-13',source_row_number:4},
  {sku:'001',to_location:'A10-2',tanggal:'10/13/2026',source_row_number:5},
  {sku:'001',to_location:' ',tanggal:'10/14/2026',source_row_number:6},
  {sku:'002',to_location:'B20-1',tanggal:'10/12/2026',source_row_number:1},
 ],async requests=>{assert.deepEqual(await fetchLastInboundLocations(env,['001','002','001']),{'001':'A10-2','002':'B20-1'});assert.equal(requests[0].searchParams.get('sku'),'in.("001","002")');assert.equal(requests[0].searchParams.get('status'),'in.("Barang Masuk","Movement")');});
});
test('history beyond 1000 rows is considered before selecting latest location',async()=>{
 const rows=Array.from({length:1000},(_,i)=>({sku:'001',to_location:'Old',tanggal:'1/1/2026',source_row_number:i+1}));rows.push({sku:'001',to_location:'A10-2',tanggal:'10/13/2026',source_row_number:2});
 await withRows(rows,async requests=>{assert.equal((await fetchLastInboundLocations(env,['001']))['001'],'A10-2');assert.equal(requests.length,2);assert.equal(requests[1].searchParams.get('offset'),'1000');});
});
test('empty SKU list needs no config or upstream reads; failed reads cannot invent a location',async()=>{assert.deepEqual(await fetchLastInboundLocations({},[]),{});const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({message:'Unavailable'}),{status:503});try{await assert.rejects(fetchLastInboundLocations(env,['001']),/Unavailable/);}finally{globalThis.fetch=original;}});
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
function render(row){
 const ctx=vm.createContext({getBalikanLocationCardRow:()=>row,getBalikanSkuLocationOptions:r=>r.locations,normalizeBalikanLocation:x=>String(x??'').trim().toLowerCase(),getPermissions:()=>({canUpdate:true}),getBalikanActiveSheetName:()=> 'TRIP 5',renderBalikanStatusBadge:()=>'',isBalikanLocationRowSelected:()=>true,esc:x=>String(x??'').replaceAll('<','&lt;'),decodeBalikanLocationValue:x=>x});
 const start=source.indexOf('function renderBalikanLocationCardContent('),end=source.indexOf('\nfunction getBalikanInventFieldKey',start);vm.runInContext(source.slice(start,end),ctx);return ctx.renderBalikanLocationCardContent([row]);
}
test('only last inbound destination is labeled independently of selected location and quantity',()=>{
 const html=render({sku:'001',rowNumber:5,lokasi:'B20-1',lastInboundLocation:' a10-2 ',locations:[{lokasi:'B20-1',qty:100},{lokasi:'A10-2',qty:0}]});assert.equal(html.split('(terakhir digunakan)').length-1,1);assert.match(html,/A10-2 <small[^>]*>\(terakhir digunakan\)/);assert.match(html,/data-location='A10-2'/);assert.match(html,/>0 pcs</);assert.doesNotMatch(html,/data-location='[^']*terakhir digunakan/);
});
test('no receipt or destination absent from stock options produces no guessed label',()=>{
 for(const latest of ['', 'Other'])assert.doesNotMatch(render({sku:'001',lokasi:'A10-2',lastInboundLocation:latest,locations:[{lokasi:'A10-2',qty:87}]}),/terakhir digunakan/);
});
test('refresh detects changed last inbound location even when TRIP and stock data are unchanged',()=>{
 const ctx=vm.createContext({Date});vm.runInContext(source.split('\n').find(line=>line.startsWith('function checksumBalikanRows(')),ctx);const row={sku:'001',rowNumber:5,locations:[{lokasi:'A10-2',qty:87}],lastInboundLocation:'A10-2'};assert.notEqual(ctx.checksumBalikanRows([row]),ctx.checksumBalikanRows([{...row,lastInboundLocation:'B20-1'}]));
});
test('latest inbound staging destinations are skipped for the previous real location',async()=>{
 await withRows([
  {sku:'001',to_location:'MASIH DI INBOUND',tanggal:'10/15/2026',source_row_number:5},
  {sku:'001',to_location:'  Masih   di inbound  ',tanggal:'10/14/2026',source_row_number:4},
  {sku:'001',to_location:'A10-2',tanggal:'10/13/2026',source_row_number:3},
  {sku:'002',to_location:'masih di inbound',tanggal:'10/15/2026',source_row_number:6},
 ],async()=>{assert.deepEqual(await fetchLastInboundLocations(env,['001','002']),{'001':'A10-2'});});
});
test('cached inbound staging locations never receive the last-used label',()=>{assert.doesNotMatch(render({sku:'001',lokasi:'MASIH DI INBOUND',lastInboundLocation:'MASIH DI INBOUND',locations:[{lokasi:'MASIH DI INBOUND',qty:0}]}),/terakhir digunakan/);});
