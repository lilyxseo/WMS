import test from 'node:test';import assert from 'node:assert/strict';
import {onRequestGet,onRequestPost} from '../functions/api/stock-entry.js';
import {validateEntries,firstEmptyLedgerRow,buildLedgerRequests,selectLedgerSheets} from '../functions/api/_stock-entry.js';
import {newEntry,entryTotals,gridDestination,entryDate,gridJump,entryNow,selectionBounds,gridFillPatches,createGridHistory,filterEntryChoices,pdfEntryItems} from '../assets/js/stock-entry.js';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SHEET_ID_2026:'sheet-2026'};
const id='c73c2ce5-2b42-49e5-9361-a86b36b842a7';
const entry=(overrides={})=>({...newEntry(),from:'STORE A',to:'A10-2',sku:'001',namaBarang:'MERLYN WHITE',qty:3,...overrides});
const header=['TANGGAL','FROM','TO','SKU','Nama barang','Qty','Status','PIC','KETERANGAN'];
const req=(body,token='valid')=>new Request('https://app.example/api/stock-entry',{method:body?'POST':'GET',headers:token?{Authorization:`Bearer ${token}`}:{},...(body?{body:JSON.stringify(body)}:{})});
function fixture(t,{role='PIC Inventory',googleError=0,throwWrite=false,holdWrite,gridColumns=16}={}){
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const jobs=new Map(),writes=[],metadata=new Map();let receipts=0;
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input);
  if(url.pathname==='/auth/v1/user')return Response.json({id:'author-1',email:'me@example.com'});
  if(url.pathname==='/rest/v1/users')return Response.json([{full_name:'Abi',role}]);
  if(url.pathname==='/rest/v1/stock_entry_batches'){
   if(options.method==='POST'){const row=JSON.parse(options.body);if(jobs.has(row.id))return Response.json([]);jobs.set(row.id,{...row,updated_at:new Date().toISOString()});return Response.json([row]);}
   let rows=[...jobs.values()].filter(row=>['id','owner','run','status'].every(key=>!url.searchParams.has(key)||row[key]===url.searchParams.get(key).slice(3)));
   if(options.method==='PATCH')rows.forEach(row=>Object.assign(row,JSON.parse(options.body)));return Response.json(rows);
  }
  if(url.pathname==='/rest/v1/inventory_kartu_stok')return Response.json([{sku:'001',nama_barang:'MERLYN WHITE',lokasi_bulky:'A10-2',stok_akhir:9}]);
  if(url.pathname==='/functions/v1/app-google-auth')return Response.json({access_token:'google-token'});
  if(url.host==='sheets.googleapis.com'){
   if(url.pathname.endsWith('/developerMetadata:search')){const key=JSON.parse(options.body).dataFilters[0].developerMetadataLookup.metadataKey;receipts++;return Response.json({matchedDeveloperMetadata:metadata.has(key)?[{developerMetadata:metadata.get(key)}]:[]});}
   if(url.pathname.endsWith(':batchUpdate')){writes.push(JSON.parse(options.body));if(holdWrite)await holdWrite();if(googleError)return Response.json({error:{message:'Denied'}},{status:googleError});for(const item of writes.at(-1).requests){if(item.createDeveloperMetadata){const m=item.createDeveloperMetadata.developerMetadata;metadata.set(m.metadataKey,m);}}if(throwWrite)throw new Error('Lost response after Google commit');return Response.json({replies:[]});}
   if(url.pathname.includes('/values/')){const range=decodeURIComponent(url.pathname.split('/values/')[1]);assert.ok(range.endsWith(':'+String.fromCharCode(64+Math.min(gridColumns,range.includes('Barang Masuk')?15:16))));return Response.json({values:[header,['old','FROM','TO','002','Other',1],[],['later','FROM','TO','003','Later',2]]});}
   return Response.json({sheets:[{properties:{sheetId:1,title:'Barang Masuk',gridProperties:{columnCount:gridColumns,rowCount:1000}}},{properties:{sheetId:2,title:'Barang KeIuar',gridProperties:{columnCount:gridColumns,rowCount:1000}}}]});
  }
  throw new Error(`Unexpected ${url}`);
 };return {jobs,writes,metadata,receipts:()=>receipts};
}
test('entry grid totals and navigation cover Tab wrapping, Shift Tab and arrow boundaries',()=>{assert.deepEqual(gridDestination(0,8,'Tab'),{row:1,col:0});assert.equal(gridDestination(0,0,'Tab',true),null);assert.deepEqual(gridDestination(2,0,'Tab',true),{row:1,col:8});assert.deepEqual(gridDestination(3,5,'Enter',true),{row:2,col:5});assert.equal(gridDestination(0,0,'ArrowUp'),null);assert.deepEqual(entryTotals([entry({used:true}),entry({used:true,qty:2}),newEntry()]),{rows:2,sku:1,qty:5});});
test('validation rejects invalid quantities, statuses, missing cells and mismatched descriptions',()=>{for(const change of [{qty:0},{qty:Infinity},{from:''},{sku:''},{status:'Movement'},{pic:'Unknown'},{tanggal:'bad'},{status:'Barang Keluar',keterangan:'RECEIPT'}])assert.throws(()=>validateEntries([entry(change)]));assert.throws(()=>validateEntries(Array.from({length:101},()=>entry())));assert.equal(validateEntries([entry({status:'Barang Keluar',keterangan:'PENGELUARAN'})])[0].qty,3);});
test('first empty business row ignores dropdown-only rows and never overwrites populated data',()=>{assert.equal(firstEmptyLedgerRow([header,['date','from','to','sku','name',1],['','','','','','','Barang Masuk','ABI']]),2);assert.throws(()=>firstEmptyLedgerRow([['wrong']]));const requests=buildLedgerRequests({sheetId:1},2,[entry({from:'=HYPERLINK("bad")'})]);assert.equal(requests[0].insertDimension.range.startIndex,2);assert.equal(requests[1].updateCells.rows[0].values[1].userEnteredValue.stringValue,'=HYPERLINK("bad")');assert.equal(typeof requests[1].updateCells.rows[0].values[0].userEnteredValue.numberValue,'number');assert.equal(requests[2].repeatCell.cell.userEnteredFormat.numberFormat.type,'DATE');});
test('ledger mapping handles the deployed capital-I outbound name and refuses ambiguous tabs',()=>{const sheets=[{properties:{title:'Barang KeIuar',sheetId:2}}];assert.equal(selectLedgerSheets(sheets,[entry({status:'Barang Keluar'})])['Barang Keluar'].sheetId,2);assert.throws(()=>selectLedgerSheets([...sheets,{properties:{title:'Barang Keluar'}}],[entry({status:'Barang Keluar'})]));});
test('anonymous and read-only users cannot save, even with a forged role',async t=>{const f=fixture(t,{role:'User'});assert.equal((await onRequestPost({env,request:req({id,entries:[entry()],role:'Developer'},'')})).status,401);assert.equal((await onRequestPost({env,request:req({id,entries:[entry()],role:'Developer'})})).status,403);assert.equal(f.writes.length,0);});
test('mixed inbound/outbound batch uses one atomic Google write and stores verified author',async t=>{const f=fixture(t);const response=await onRequestPost({env,request:req({id,entries:[entry(),entry({status:'Barang Keluar',keterangan:'PENGELUARAN'})]})});assert.equal(response.status,200);assert.equal(f.writes.length,1);assert.equal(f.writes[0].requests.filter(r=>r.insertDimension).length,2);assert.equal(f.writes[0].requests.at(-1).createDeveloperMetadata.developerMetadata.metadataKey,`wms_input_${id}`);assert.equal(f.jobs.get(id).status,'saved');assert.equal(f.jobs.get(id).author_name,'Abi');assert.equal(f.jobs.get(id).author_role,'PIC Inventory');});
test('replaying identical batch never writes twice and changing a used ID is rejected',async t=>{const f=fixture(t),entries=[entry()];await onRequestPost({env,request:req({id,entries})});assert.equal((await onRequestPost({env,request:req({id,entries})})).status,200);assert.equal(f.writes.length,1);assert.equal((await onRequestPost({env,request:req({id,entries:[entry({qty:5})]})})).status,409);assert.equal(f.writes.length,1);});
test('uncertain Google response reconciles atomic receipt without another transaction write',async t=>{const f=fixture(t,{throwWrite:true}),entries=[entry()];const first=await onRequestPost({env,request:req({id,entries})});assert.equal(first.status,503);assert.equal((await first.json()).retryable,false);assert.equal(f.jobs.get(id).status,'uncertain');const check=new Request(`https://app.example/api/stock-entry?id=${id}`,{headers:{Authorization:'Bearer valid'}});assert.equal((await onRequestGet({env,request:check})).status,200);assert.equal(f.writes.length,1);assert.equal(f.jobs.get(id).status,'saved');assert.equal(f.receipts(),1);});
test('Google rejection keeps transaction retryable and does not claim success',async t=>{const f=fixture(t,{googleError:400});const response=await onRequestPost({env,request:req({id,entries:[entry()]})});assert.equal(response.status,503);assert.equal((await response.json()).retryable,true);assert.equal(f.jobs.get(id).status,'failed');});
test('duplicate concurrent submission observes the durable claim and creates only one batch',async t=>{let release,arrived;const held=new Promise(r=>release=r),started=new Promise(r=>arrived=r);const f=fixture(t,{holdWrite:()=>{arrived();return held;}}),entries=[entry()];const first=onRequestPost({env,request:req({id,entries})});await started;const duplicate=await onRequestPost({env,request:req({id,entries})});assert.equal(duplicate.status,409);assert.equal(f.writes.length,1);release();assert.equal((await first).status,200);});
test('changed SKU name is rejected before any Google transaction and draft remains retryable',async t=>{const f=fixture(t);const response=await onRequestPost({env,request:req({id,entries:[entry({namaBarang:'Wrong name'})]})});assert.equal(response.status,503);assert.equal((await response.json()).retryable,true);assert.equal(f.writes.length,0);assert.equal(f.jobs.get(id).status,'failed');});
test('uncertain request without a receipt is never automatically written again',async t=>{const f=fixture(t,{googleError:503});const entries=[entry()];await onRequestPost({env,request:req({id,entries})});const retry=await onRequestPost({env,request:req({id,entries})});assert.equal(retry.status,409);assert.equal((await retry.json()).retryable,false);assert.equal(f.writes.length,1);});
test('expired preparation can be released but an in-flight write cannot be stolen',async t=>{const f=fixture(t);f.jobs.set(id,{id,owner:'author-1',status:'preparing',run:crypto.randomUUID(),payload_hash:'hash',updated_at:'2026-01-01T00:00:00Z'});const response=await onRequestGet({env,request:new Request('https://app.example/api/stock-entry?id='+id,{headers:{Authorization:'Bearer valid'}})});assert.equal((await response.json()).retryable,true);assert.equal(f.jobs.get(id).status,'failed');assert.equal(f.writes.length,0);});
test('request status is scoped to verified owner and never leaks another author receipt',async t=>{const f=fixture(t);f.jobs.set(id,{id,owner:'someone-else',status:'saved',result:{count:99}});const response=await onRequestGet({env,request:new Request('https://app.example/api/stock-entry?id='+id,{headers:{Authorization:'Bearer valid'}})});assert.equal(response.status,404);assert.equal((await response.json()).result,undefined);assert.equal(f.receipts(),0);});

test('spreadsheet date paste strips time and accepts displayed M/D/YYYY values',()=>{assert.equal(entryDate('10/17/2026 10:03:31'),'2026-10-17');assert.equal(entryDate('10/17/2026 1:03 PM'),'2026-10-17');assert.equal(entryDate('2026-10-17'),'2026-10-17');assert.throws(()=>validateEntries([entry({tanggal:'2026-02-31T12:00:00'})]));});

test('ledger range respects tabs that only contain the nine form columns',async t=>{const f=fixture(t,{gridColumns:9});const response=await onRequestPost({env,request:req({id,entries:[entry()]})});assert.equal(response.status,200);assert.equal(f.writes.length,1);});

test('new rows show today immediately with no From/To defaults or timestamp',()=>{const row=newEntry();assert.equal(row.from,'');assert.equal(row.to,'');assert.equal(row.tanggal,entryNow());assert.match(row.tanggal,/^\d{4}-\d{2}-\d{2}$/);});
test('Ctrl arrows traverse contiguous data, gaps and grid edges like a spreadsheet',()=>{
 const rows=Array.from({length:8},()=>newEntry());rows[0].sku='A';rows[1].sku='B';rows[2].sku='C';rows[5].sku='D';
 assert.deepEqual(gridJump(rows,0,3,'ArrowDown'),{row:2,col:3});assert.deepEqual(gridJump(rows,2,3,'ArrowDown'),{row:5,col:3});assert.deepEqual(gridJump(rows,5,3,'ArrowDown'),{row:7,col:3});assert.deepEqual(gridJump(rows,5,3,'ArrowUp'),{row:2,col:3});assert.deepEqual(gridJump(rows,2,3,'ArrowUp'),{row:0,col:3});assert.deepEqual(gridJump(rows,0,0,'ArrowLeft'),{row:0,col:0});
 rows[0].from='FROM';rows[0].to='TO';assert.deepEqual(gridJump(rows,0,0,'ArrowRight'),{row:0,col:3});assert.deepEqual(gridJump(rows,0,3,'ArrowRight'),{row:0,col:6});assert.deepEqual(gridJump(rows,0,6,'ArrowRight'),{row:0,col:8});
});

test('range bounds work in reverse and Ctrl D fills from the top row across selected columns',()=>{
 const rows=[entry({from:'A',to:'B'}),entry({from:'C',to:'D'}),entry({from:'E',to:'F'})],selection={anchor:{row:2,col:2},active:{row:0,col:1}};
 assert.deepEqual(selectionBounds(selection),{top:0,bottom:2,left:1,right:2});
 assert.deepEqual(gridFillPatches(rows,selection,'down'),[{row:1,col:1,value:'A'},{row:1,col:2,value:'B'},{row:2,col:1,value:'A'},{row:2,col:2,value:'B'}]);assert.equal(rows[2].from,'E');
});
test('Ctrl R fills each selected row from its own left column; single cells use adjacent source',()=>{
 const rows=[entry({from:'A',to:'B'}),entry({from:'C',to:'D'})];
 assert.deepEqual(gridFillPatches(rows,{anchor:{row:0,col:1},active:{row:1,col:2}},'right'),[{row:0,col:2,value:'A'},{row:1,col:2,value:'C'}]);
 assert.deepEqual(gridFillPatches(rows,{anchor:{row:1,col:1},active:{row:1,col:1}},'down'),[{row:1,col:1,value:'A'}]);
 assert.deepEqual(gridFillPatches(rows,{anchor:{row:0,col:2},active:{row:0,col:2}},'right'),[{row:0,col:2,value:'A'}]);
 assert.deepEqual(gridFillPatches(rows,{anchor:{row:0,col:0},active:{row:0,col:0}},'down'),[]);assert.deepEqual(gridFillPatches(rows,{anchor:{row:0,col:0},active:{row:0,col:0}},'right'),[]);
});

test('Undo groups cell typing and derived values, restores selection and clones snapshots',()=>{
 const history=createGridHistory(),state=value=>({rows:[entry({from:value})],selection:{anchor:{row:0,col:1},active:{row:0,col:1}}});const before=state(''),first=state('A'),last=state('AB');
 history.record(before,first,'cell-1');history.record(first,last,'cell-1');last.rows[0].from='mutated';
 assert.equal(history.undo().rows[0].from,'');assert.equal(history.undo(),null);const redone=history.redo();assert.equal(redone.rows[0].from,'AB');assert.deepEqual(redone.selection,before.selection);redone.rows[0].from='outside';history.undo();assert.equal(history.redo().rows[0].from,'AB');
});
test('new edits after Undo discard Redo; no-op edits retain history and limits are bounded',()=>{
 const history=createGridHistory(2),state=value=>({rows:[entry({qty:value})],selection:null});
 history.record(state(0),state(1));history.record(state(1),state(2));history.record(state(2),state(3));assert.equal(history.undo().rows[0].qty,2);assert.equal(history.undo().rows[0].qty,1);assert.equal(history.undo(),null);
 history.record(state(1),state(1));assert.equal(history.redo().rows[0].qty,2);history.undo();history.record(state(1),state(9));assert.equal(history.redo(),null);assert.equal(history.undo().rows[0].qty,1);
});
test('clearing history after a saved batch prevents Undo from resurrecting committed input',()=>{const history=createGridHistory();history.record({rows:[]},{rows:[entry()]});history.clear();assert.equal(history.undo(),null);assert.equal(history.redo(),null);});

test('dropdown search matches substrings case-insensitively and returns no invented values',()=>{assert.deepEqual(filterEntryChoices(['Barang Masuk','Barang Keluar'],'KE'),['Barang Keluar']);assert.deepEqual(filterEntryChoices(['ABI','ENGGAL','EPRIL'],'eng'),['ENGGAL']);assert.deepEqual(filterEntryChoices(['RECEIPT','PENGELUARAN'],' xyz '),[]);assert.equal(filterEntryChoices(['ABI','ENGGAL'],'').length,2);});

test('PDF input uses only SKU, authoritative master name and qty, preserving leading zeros',()=>{
 const items=[{sku:'001',namaProduk:'WRONG PDF NAME',qty:8,from:'PDF FROM',to:'PDF TO',pic:'WINDI',tanggal:'2000-01-01',catatan:'PDF NOTE'},{sku:'002',namaProduk:'UNKNOWN NAME',qty:2}];
 assert.deepEqual(pdfEntryItems(items,[{sku:'001',namaBarang:'MASTER NAME'},{sku:'001',namaBarang:'MASTER NAME'}]),[{sku:'001',namaBarang:'MASTER NAME',qty:'8'},{sku:'002',namaBarang:'',qty:'2'}]);
 assert.deepEqual(pdfEntryItems([items[0]],[{sku:'001',namaBarang:'NAME A'},{sku:'001',namaBarang:'NAME B'}]),[{sku:'001',namaBarang:'',qty:'8'}]);
 for(const qty of [0,-1,Infinity,NaN])assert.throws(()=>pdfEntryItems([{sku:'001',qty}],[]));
 assert.throws(()=>pdfEntryItems([],[]));assert.throws(()=>pdfEntryItems(Array.from({length:101},()=>items[0]),[]));
});
test('PDF master lookup requires authentication and exact SKU filters, pages all locations and never writes',async t=>{
 fixture(t);const base=globalThis.fetch,queries=[];
 globalThis.fetch=async(url,options)=>{const parsed=new URL(url);if(parsed.pathname==='/rest/v1/inventory_kartu_stok'){assert.equal(options?.method||'GET','GET');queries.push(parsed);return Response.json(parsed.searchParams.get('offset')==='0'?Array.from({length:1000},()=>({sku:'001',nama_barang:'MASTER'})):[{sku:'001',nama_barang:'MASTER'}]);}return base(url,options);};
 const url='https://app.example/api/stock-entry?'+new URLSearchParams({skus:JSON.stringify(['001','SKU"with\\quotes'])});
 assert.equal((await onRequestGet({request:new Request(url),env})).status,401);
 const response=await onRequestGet({request:new Request(url,{headers:{Authorization:'Bearer valid'}}),env});assert.equal(response.status,200);assert.equal((await response.json()).items.length,1001);
 assert.equal(queries.length,2);assert.equal(queries[0].searchParams.get('sku'),'in.("001","SKU\\"with\\\\quotes")');assert.equal(queries[1].searchParams.get('offset'),'1000');
 for(const skus of ['bad','[]',JSON.stringify(Array(101).fill('001'))])assert.equal((await onRequestGet({request:new Request('https://app.example/api/stock-entry?'+new URLSearchParams({skus}),{headers:{Authorization:'Bearer valid'}}),env})).status,400);
});
