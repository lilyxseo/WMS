import test from 'node:test';import assert from 'node:assert/strict';
import {parseEntryContentRows,entryImportFileKind} from '../assets/js/entry-import-content.js';
import {excelEntryItems} from '../assets/js/stock-entry-excel.js';
const row=(values,number=1)=>({values,number});
test('headerless data detects values in different orders, retains zeros and duplicate SKU rows',()=>{
 const parsed=excelEntryItems([row(['Transfer #T-008937']),row([1,'GOTO BACKPACK PINK','682200000277',12],2),row(['GT-EMGJ-BL','GOTO ELECTRIC FAN',3],3),row([4,'0000000123','GOTO STORAGE BOX'],4),row(['GT-EMGJ-BL','GOTO ELECTRIC FAN',2],5),row(['Total',21])]);
 assert.deepEqual(parsed.items,[{sku:'682200000277',namaProduk:'GOTO BACKPACK PINK',qty:12},{sku:'GT-EMGJ-BL',namaProduk:'GOTO ELECTRIC FAN',qty:3},{sku:'0000000123',namaProduk:'GOTO STORAGE BOX',qty:4},{sku:'GT-EMGJ-BL',namaProduk:'GOTO ELECTRIC FAN',qty:2}]);
});
test('PDF value rows support split text and collapsed lines without mistaking dimensions for Qty',()=>{
 const parsed=parseEntryContentRows([row(['682200000277','GOTO','BACKPACK','PINK','12']),row(['1 GT-EMGJ-BL GOTO FAN 30 X 40 BLACK 6 pcs'])]);
 assert.deepEqual(parsed.items,[{sku:'682200000277',namaProduk:'GOTO BACKPACK PINK',qty:12},{sku:'GT-EMGJ-BL',namaProduk:'GOTO FAN 30 X 40 BLACK',qty:6}]);
});
test('content detection does not guess ambiguous Qty or import dates, locations and transfer numbers',()=>{
 const parsed=parseEntryContentRows([row(['2026-10-27','STORE KARAWACI',4]),row(['A01-2','GOTO STORAGE BOX',4]),row(['T-008937','GOTO STORAGE BOX',4]),row(['682200000277','GOTO BACKPACK PINK',4,2],7)]);
 assert.equal(parsed.items.length,0);assert.equal(parsed.failedRows.length,1);assert.equal(parsed.failedRows[0].row,7);
});
test('file parser is selected by actual bytes rather than the extension or MIME type',async()=>{
 const pdf=new File(['%PDF-1.7\ncontent'],'wrong.xlsx',{type:'application/octet-stream'});
 const xlsx=new File([new Uint8Array([0x50,0x4b,3,4,0,0])],'wrong.pdf',{type:'application/pdf'});
 assert.equal(await entryImportFileKind(pdf),'pdf');assert.equal(await entryImportFileKind(xlsx),'excel');
 await assert.rejects(()=>entryImportFileKind(new File(['not a PDF'],'fake.pdf')),/Isi file/);
});
