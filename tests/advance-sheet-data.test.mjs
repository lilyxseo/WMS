import test from 'node:test';
import assert from 'node:assert/strict';
import {readSkuTables} from '../functions/api/_advance-sheet-data.js';
import {handleAdvanceSources,resolveAdvanceSpreadsheet} from '../functions/api/advance-search-sources.js';

test('COUNT 1 reads both side-by-side tables with different SKU columns and preserves zero and leading zeros',()=>{
 const values=[['SO 2026'],['Lokasi','SKU','Nama Barang','Qty','','SKU','Nama Barang','Aktual','Catatan'],['A01-1','0012','Product A',0,'','0012','Product A',3,'second table'],['A02-1','12','Other',10,'','0012-X','Other',20,'not exact']];
 const groups=readSkuTables(values,'0012',{sheetName:'COUNT 1'});assert.equal(groups.length,2);assert.equal(groups[0].rows.length,1);assert.equal(groups[1].rows.length,1);assert.equal(groups[0].rows[0].sku,'0012');assert.equal(groups[0].rows[0].Qty,0);assert.equal(groups[1].rows[0].Aktual,3);assert.equal(groups[1].rows[0].Catatan,'second table');assert.equal(groups[1].rows[0].baris,3);
});
test('COUNT 1 supports two stacked tables with reordered columns without mixing histories',()=>{
 const groups=readSkuTables([['SKU','Nama Barang','Stok'],['0012','Product',4],[],['Lokasi','SKU','Nama Barang','Count','Keterangan'],['A01-1','0012','Product',2,'verified']], '0012',{sheetName:'COUNT 1'});assert.equal(groups.length,2);assert.equal(groups[0].rows.length,1);assert.equal(groups[1].rows.length,1);assert.equal(groups[1].rows[0].Count,2);assert.equal(groups[1].rows[0].baris,5);
});
test('adjacent tables without blank separator preserve each table location columns',()=>{
 const groups=readSkuTables([['Lokasi','SKU','Nama Barang','Qty','Lokasi','SKU','Nama Barang','Qty'],['A01-1','0012','A',2,'B01-1','0012','A',5]],'0012',{minimumTables:2});assert.equal(groups[0].rows[0].Lokasi,'A01-1');assert.equal(groups[1].rows[0].Lokasi,'B01-1');assert.equal(groups[0].rows[0].Qty,2);assert.equal(groups[1].rows[0].Qty,5);
});
test('COUNT 1 reads two vertical data blocks that share one header without requiring duplicate schemas',()=>{
 const data=readSkuTables([['SKU','Nama Barang','Qty'],['0012','First block',2],[],[],['0012','Second block',7]],'0012',{sheetName:'COUNT 1'});
 assert.equal(data.length,1);assert.deepEqual(data[0].rows.map(row=>row.Qty),[2,7]);assert.deepEqual(data[0].rows.map(row=>row.baris),[2,5]);
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
test('SO JULI 2025 reads Inventory while COUNT 1 accepts shared schemas',async()=>{
 const deps=dependencies(['SO JULI 2025'],{'SO JULI 2025':[['SKU','Nama Barang','Qty'],['0012','A',4]]});const response=await handleAdvanceSources({request:req('so2025'),env:{}},deps);assert.equal(response.status,200);assert.equal((await response.json()).groups[0].rows[0].Qty,4);
 const fail=await handleAdvanceSources({request:req('so2026'),env:{SO_2026_SPREADSHEET_ID:'T'.repeat(30)}},dependencies(['COUNT 1'],{'COUNT 1':[['SKU','Nama Barang','Qty'],['0012','A',1]]}));assert.equal(fail.status,200);assert.equal((await fail.json()).groups[0].rows[0].Qty,1);
});
test('Balikan discovers all TRIP tabs and preserves original extra columns with no other SKU leakage',async()=>{
 const values={};for(const title of ['TRIP 1','TRIP 2'])values[title]=[['Centang','SKU','Nama Barang','Qty','Custom Field'],[false,'0012','Product',0,title],[false,'12','Other',999,'not returned']];
 const response=await handleAdvanceSources({request:req('trips'),env:{}},dependencies(['Other','TRIP 1','TRIP 2'],values));assert.equal(response.status,200);const data=await response.json();assert.equal(data.groups.length,1);assert.equal(data.groups[0].rows.length,2);assert.deepEqual(data.groups[0].rows.map(row=>row['Sumber Sheet']),['TRIP 1','TRIP 2']);assert.equal(data.groups[0].rows[0]['Custom Field'],'TRIP 1');assert.equal(data.groups[0].rows[0].qty,'0');
});
test('additional source reads require authentication and reject invalid source/SKU',async()=>{
 assert.equal((await handleAdvanceSources({request:req('trips'),env:{}},{authorize:async()=>false})).status,401);
 assert.equal((await handleAdvanceSources({request:req('unknown'),env:{}},{authorize:async()=>true})).status,400);
});

test('a Barcode field beside SKU is not mistaken for the second COUNT 1 table',()=>{
 const data=readSkuTables([['SKU','Barcode','Nama Barang','Qty'],['0012','456','A',2]],'0012',{sheetName:'COUNT 1'});assert.equal(data.length,1);assert.equal(data[0].rows[0].Barcode,'456');
});
test('one unparseable TRIP remains a visible partial failure and does not erase other TRIPs',async()=>{
 const values={'TRIP 1':[['Centang','SKU','Nama Barang','Qty'],[false,'0012','A',2]],'TRIP 2':[['Unknown layout']]};
 const response=await handleAdvanceSources({request:req('trips'),env:{}},dependencies(Object.keys(values),values));assert.equal(response.status,200);const data=await response.json();assert.equal(data.partial,true);assert.equal(data.groups.length,1);assert.equal(data.failures[0].sheet,'TRIP 2');
});

test('COUNT 1 recognizes decorated headers, independent layouts, and arbitrary original business columns',()=>{
 const data=readSkuTables([
  ['Kode\nBarang','Nama Produk','Qty System','PIC Pemeriksa','','SKU (Fisik)','Nama Barang','Hasil Hitung','Kondisi'],
  ['0012','A',2,'First checker','','0012','A',4,'Good'],
 ],'0012',{sheetName:'COUNT 1'});
 assert.equal(data.length,2);assert.equal(data[0].rows[0]['PIC Pemeriksa'],'First checker');assert.equal(data[1].rows[0]['Hasil Hitung'],4);assert.equal(data[1].rows[0].Kondisi,'Good');
});
test('COUNT 1 reads multirow headers and does not consume the first matching data row',()=>{
 const data=readSkuTables([
  ['SKU','Nama Barang','Stok','','ITEM NUMBER','Item Name','Count'],
  ['', 'Deskripsi','System','','','Description','Aktual'],
  ['0012','First',0,'','0012','Second',3],
 ],'0012',{sheetName:'COUNT 1'});
 assert.equal(data.length,2);assert.equal(data[0].rows.length,1);assert.equal(data[1].rows.length,1);assert.equal(data[0].rows[0]['Stok / System'],0);assert.equal(data[1].rows[0]['Count / Aktual'],3);assert.equal(data[1].rows[0].baris,3);
});
test('unrecognized headers remain errors instead of reporting an empty stock count',()=>{
 assert.throws(()=>readSkuTables([['Mystery'],['0012',10]],'0012',{sheetName:'COUNT 1'}),/header data/);
});
test('unified Balikan preserves different dynamic columns and a source-named original field without overwriting provenance',async()=>{
 const values={'TRIP 1':[['Centang','SKU','Nama Barang','Qty','Sumber Sheet','Extra'],[false,'0012','A',2,'raw source','a']], 'TRIP 2':[['Centang','SKU','Nama Barang','Qty','Extra','Other'],[false,'0012','B',0,'b','c']]};
 const response=await handleAdvanceSources({request:req('trips'),env:{}},dependencies(Object.keys(values),values));const data=await response.json();assert.equal(data.groups.length,1);assert.equal(data.groups[0].rows.length,2);assert.equal(data.groups[0].rows[0]['Sumber Sheet'],'TRIP 1');assert.equal(data.groups[0].rows[0]['Sumber Sheet (extra_4)'],'raw source');assert.equal(data.groups[0].rows[1].Other,'c');assert.deepEqual(data.groups[0].rows.map(row=>row.Extra),['a','b']);
});

test('staggered side-by-side headers do not truncate the other tables rows',()=>{
 const data=readSkuTables([
 ['SKU','Nama Barang','Qty'],
 ['0012','Left first',1],
 ['0012','Left second',2,'','SKU LAMA','Nama Barang','Qty'],
 ['0012','Left third',3,'','0012','Right',4],
 ],'0012',{sheetName:'COUNT 1'});
 assert.equal(data.length,2);assert.deepEqual(data[0].rows.map(row=>row.Qty),[1,2,3]);assert.equal(data[1].rows[0].Qty,4);
});
