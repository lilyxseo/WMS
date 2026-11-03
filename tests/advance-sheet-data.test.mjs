import test from 'node:test';
import assert from 'node:assert/strict';
import {readSkuTables} from '../functions/api/_advance-sheet-data.js';
import {handleAdvanceSources,resolveAdvanceSpreadsheet} from '../functions/api/advance-search-sources.js';

test('COUNT 1 reads both side-by-side tables with different SKU columns and preserves zero and leading zeros',()=>{
 const values=[['SO 2026'],['Lokasi','SKU','Nama Barang','Qty','','SKU','Nama Barang','Aktual','Catatan'],['A01-1','0012','Product A',0,'','0012','Product A',3,'second table'],['A02-1','12','Other',10,'','0012-X','Other',20,'not exact']];
 const groups=readSkuTables(values,'0012',{sheetName:'COUNT 1',minimumTables:2});assert.equal(groups.length,2);assert.equal(groups[0].rows.length,1);assert.equal(groups[1].rows.length,1);assert.equal(groups[0].rows[0].sku,'0012');assert.equal(groups[0].rows[0].Qty,0);assert.equal(groups[1].rows[0].Aktual,3);assert.equal(groups[1].rows[0].Catatan,'second table');assert.equal(groups[1].rows[0].baris,3);
});
test('COUNT 1 supports two stacked tables with reordered columns without mixing histories',()=>{
 const groups=readSkuTables([['SKU','Nama Barang','Stok'],['0012','Product',4],[],['Lokasi','SKU','Nama Barang','Count','Keterangan'],['A01-1','0012','Product',2,'verified']], '0012',{sheetName:'COUNT 1',minimumTables:2});assert.equal(groups.length,2);assert.equal(groups[0].rows.length,1);assert.equal(groups[1].rows.length,1);assert.equal(groups[1].rows[0].Count,2);assert.equal(groups[1].rows[0].baris,5);
});
test('adjacent tables without blank separator preserve each table location columns',()=>{
 const groups=readSkuTables([['Lokasi','SKU','Nama Barang','Qty','Lokasi','SKU','Nama Barang','Qty'],['A01-1','0012','A',2,'B01-1','0012','A',5]],'0012',{minimumTables:2});assert.equal(groups[0].rows[0].Lokasi,'A01-1');assert.equal(groups[1].rows[0].Lokasi,'B01-1');assert.equal(groups[0].rows[0].Qty,2);assert.equal(groups[1].rows[0].Qty,5);
});
test('COUNT 1 fails explicitly when only one table can be recognized',()=>{
 assert.throws(()=>readSkuTables([['SKU','Nama Barang','Qty'],['0012','Product',2]],'0012',{sheetName:'COUNT 1',minimumTables:2}),/kedua tabel/);
});
test('SO 2026 is resolved from registered Archives and ambiguous sources never silently substitute inventory',async()=>{
 assert.equal(await resolveAdvanceSpreadsheet('so2026',{},async()=>[{name:'SO 2026',spreadsheet_id:'S'.repeat(30)}]),'S'.repeat(30));
 await assert.rejects(resolveAdvanceSpreadsheet('so2026',{},async()=>[]),/belum terdaftar/);
 assert.equal(await resolveAdvanceSpreadsheet('so2026',{SO_2026_SPREADSHEET_ID:'T'.repeat(30)}),'T'.repeat(30));
});
const req=(source,sku='0012')=>new Request('https://wms.test/api/advance-search-sources?'+new URLSearchParams({source,sku}));
const dependencies=(sheets,values)=>({authorize:async()=>true,getToken:async()=> 'test',fetch:async url=>{
 const parsed=new URL(url);if(parsed.pathname.endsWith('batchGet'))return Response.json({valueRanges:parsed.searchParams.getAll('ranges').map(range=>({values:values[range.split("'")[1]]}))});
 return Response.json({sheets:sheets.map(title=>({properties:{title,gridProperties:{columnCount:12}}}))});
}});
test('2025 transactions resolve both archive tabs and return only exact SKU source rows',async()=>{
 const source={};for(const title of ['Barang Masuk','Barang KeIuar'])source[title]=[['Tanggal','From','To','SKU','Nama Barang','Qty'],['2025-07-01','A','B','0012','Product',2],['2025-07-02','A','B','12','Other',9]];
 const response=await handleAdvanceSources({request:req('ledger2025'),env:{}},dependencies(Object.keys(source),source));assert.equal(response.status,200);const data=await response.json();assert.equal(data.groups.length,2);assert.ok(data.groups.every(group=>group.rows.length===1&&group.rows[0].sku==='0012'));assert.ok(data.groups[0].name.includes('2025'));
});
test('SO JULI 2025 reads Inventory while COUNT 1 requires both tables',async()=>{
 const deps=dependencies(['SO JULI 2025'],{'SO JULI 2025':[['SKU','Nama Barang','Qty'],['0012','A',4]]});const response=await handleAdvanceSources({request:req('so2025'),env:{}},deps);assert.equal(response.status,200);assert.equal((await response.json()).groups[0].rows[0].Qty,4);
 const fail=await handleAdvanceSources({request:req('so2026'),env:{SO_2026_SPREADSHEET_ID:'T'.repeat(30)}},dependencies(['COUNT 1'],{'COUNT 1':[['SKU','Nama Barang','Qty'],['0012','A',1]]}));assert.equal(fail.status,503);assert.match((await fail.json()).message,/kedua tabel/);
});
test('Balikan discovers all TRIP tabs and preserves original extra columns with no other SKU leakage',async()=>{
 const values={};for(const title of ['TRIP 1','TRIP 2'])values[title]=[['Centang','SKU','Nama Barang','Qty','Custom Field'],[false,'0012','Product',0,title],[false,'12','Other',999,'not returned']];
 const response=await handleAdvanceSources({request:req('trips'),env:{}},dependencies(['Other','TRIP 1','TRIP 2'],values));assert.equal(response.status,200);const data=await response.json();assert.equal(data.groups.length,2);assert.ok(data.groups.every(group=>group.rows.length===1));assert.equal(data.groups[0].rows[0]['Custom Field (extra_4)'],'TRIP 1');assert.equal(data.groups[0].rows[0].qty,'0');
});
test('additional source reads require authentication and reject invalid source/SKU',async()=>{
 assert.equal((await handleAdvanceSources({request:req('trips'),env:{}},{authorize:async()=>false})).status,401);
 assert.equal((await handleAdvanceSources({request:req('unknown'),env:{}},{authorize:async()=>true})).status,400);
});

test('a Barcode field beside SKU is not mistaken for the second COUNT 1 table',()=>{
 assert.throws(()=>readSkuTables([['SKU','Barcode','Nama Barang','Qty'],['0012','456','A',2]],'0012',{sheetName:'COUNT 1',minimumTables:2}),/kedua tabel/);
});
test('one unparseable TRIP remains a visible partial failure and does not erase other TRIPs',async()=>{
 const values={'TRIP 1':[['Centang','SKU','Nama Barang','Qty'],[false,'0012','A',2]],'TRIP 2':[['Unknown layout']]};
 const response=await handleAdvanceSources({request:req('trips'),env:{}},dependencies(Object.keys(values),values));assert.equal(response.status,200);const data=await response.json();assert.equal(data.partial,true);assert.equal(data.groups.length,1);assert.equal(data.failures[0].sheet,'TRIP 2');
});
