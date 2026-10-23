import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveColumn,archiveAddress,parseArchiveGrid,extendArchiveGrid,archiveCellDescriptor} from '../assets/js/archive-grid.js';
import {onRequestPost,validateArchiveEdits} from '../functions/api/archive-data.js';

test('archive grid retains A1, blank rows, duplicate headings, zero and false without guessing headers',()=>{
 const values=[['Warehouse'],[],['SKU','SKU','Qty'],['A','B',0,false],[],['C']],grid=parseArchiveGrid(values,{gridProperties:{rowCount:1000,columnCount:30},formulaValues:[...values.slice(0,3),['A','B','=1-1',false]]});
 assert.deepEqual(grid.columns.slice(0,4),['A','B','C','D']);assert.equal(grid.rows[0].A,'Warehouse');assert.equal(grid.rows[1].A,'');assert.equal(grid.rows[2].B,'SKU');assert.equal(grid.rows[3].C,0);assert.equal(grid.rows[3].D,false);assert.equal(grid.rows[3].__raw.C,'=1-1');assert.equal(grid.rows[5].__rowNumber,6);assert.equal(grid.rows[5].A,'C');
 const empty=parseArchiveGrid([],{gridProperties:{rowCount:50,columnCount:5}});assert.equal(empty.rows.length,50);assert.deepEqual(empty.columns,['A','B','C','D','E']);
});
test('archive jump preserves source row numbers and supports columns beyond Z within sheet bounds',()=>{
 const grid=parseArchiveGrid([['x']],{gridProperties:{rowCount:500,columnCount:52}});assert.equal(archiveColumn(27),'AA');assert.deepEqual(archiveAddress(' aa200 '),{column:27,row:200,address:'AA200'});assert.equal(archiveAddress('A0'),null);assert.throws(()=>extendArchiveGrid(grid,'BA1'));extendArchiveGrid(grid,'AA200');assert.equal(grid.rows[199].__rowNumber,200);assert.equal(grid.columns[26],'AA');assert.equal(grid.rows[0].A,'x');
 const d=archiveCellDescriptor({dataset:{archiveRow:'200',archiveCol:'AA'}},grid,'archive:id::sheet','sheet','id');assert.equal(d.rowNumber,200);assert.equal(d.value,'');assert.doesNotThrow(()=>d.validate('=SUM(A1:A2)'));
});
const id='archive-spreadsheet-123456789',env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},title="Data '2026",props={title,gridProperties:{rowCount:100,columnCount:30}};
async function write({role='PIC Inventory',auth=true,registered=true,edits=[{row:4,column:3,before:'=1-1',value:'=2-1'}],actual='=1-1',googleError=false}={}){
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init={})=>{calls.push({url,init});if(url.includes('/auth/v1/user'))return Response.json({id:'verified'});if(url.includes('/rest/v1/users'))return Response.json([{role}]);if(url.includes('/archive_spreadsheets'))return Response.json(registered?[{spreadsheet_id:id}]:[]);if(url.includes('/app-google-auth'))return Response.json({access_token:'private-test-token'});
 if(url.includes('/values:batchGet')){const count=new URL(url).searchParams.getAll('ranges').length;return Response.json({valueRanges:Array.from({length:count},()=>({values:[[actual]]}))});}
 if(url.includes('/values:batchUpdate')){if(googleError)return Response.json({error:{message:'secret upstream detail'}},{status:403});const body=JSON.parse(init.body);return Response.json({responses:body.data.map(()=>({updatedData:{values:[['1']]}}))});}
 if(url.includes('sheets.googleapis.com'))return Response.json({sheets:[{properties:props}]});throw Error('Unexpected mock URL');};
 try{const response=await onRequestPost({env,request:new Request('https://test/api/archive-data',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer session'}:{}),'x-developer-user':'true'},body:JSON.stringify({spreadsheetId:id,sheet:title,edits})})});return {status:response.status,data:await response.json(),calls};}finally{globalThis.fetch=original;}
}
test('archive edits require server-verified edit role and a registered spreadsheet, ignoring spoofed headers',async()=>{
 for(const role of ['Staff','Admin','User']){const result=await write({role});assert.equal(result.status,403);assert.ok(!result.calls.some(c=>c.url.includes('googleapis')));}
 assert.equal((await write({auth:false})).status,401);assert.equal((await write({registered:false})).status,404);
});
test('archive stale cell conflict performs no writes and formulas are compared rather than formatted results',async()=>{
 const result=await write({actual:'=2-2'});assert.equal(result.status,409);assert.equal(result.data.code,'ARCHIVE_CELL_CONFLICT');assert.ok(!result.calls.some(c=>c.url.includes('batchUpdate')));
});
test('archive writes only changed original A1 cells in one batch and returns formatted output',async()=>{
 const result=await write();assert.equal(result.status,200);const writes=result.calls.filter(c=>c.url.includes('batchUpdate'));assert.equal(writes.length,1);const body=JSON.parse(writes[0].init.body);assert.equal(body.valueInputOption,'USER_ENTERED');assert.deepEqual(body.data,[{range:"'Data ''2026'!C4",values:[['=2-1']]}]);assert.deepEqual(result.data.cells,[{address:'C4',value:'1'}]);assert.ok(!JSON.stringify(result.data).includes('private-test-token'));
});
test('archive validates the whole edit batch, bounds, duplicates and value sizes before a write',async()=>{
 for(const edits of [[],[{row:0,column:1,before:'',value:'x'}],[{row:1,column:31,before:'',value:'x'}],[{row:1,column:1,value:'x'}],[{row:1,column:1,before:'',value:'x'.repeat(10001)}],[{row:1,column:1,before:'',value:'x'},{row:1,column:1,before:'',value:'y'}]]){const result=await write({edits});assert.equal(result.status,400);assert.ok(!result.calls.some(c=>c.url.includes('batchUpdate')));}
 assert.throws(()=>validateArchiveEdits([{row:1,column:1,before:'',value:'x'}],{gridProperties:{}}),/Ukuran/);
});
test('archive Google write rejection is not retried or reported as success',async()=>{const result=await write({googleError:true});assert.equal(result.status,503);assert.equal(result.data.success,false);assert.equal(result.calls.filter(c=>c.url.includes('batchUpdate')).length,1);assert.ok(!JSON.stringify(result.data).includes('secret upstream detail'));});
