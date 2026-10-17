import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../assets/js/main.js',import.meta.url),'utf8');
function parser(pages){
 let destroyed=0,cleaned=0;
 const context=vm.createContext({window:{pdfjsLib:{getDocument:()=>({promise:Promise.resolve({numPages:pages.length,getPage:async n=>({getTextContent:async()=>({items:pages[n-1]}),cleanup(){cleaned++;}})}),destroy:async()=>{destroyed++;}})}},clean:s=>String(s).trim().toLowerCase()});
 vm.runInContext(source.slice(source.indexOf('function getPdfJsLib(){'),source.indexOf('function formatPdfTransferFileSize(')),context);
 return {read:()=>context.readTransferPdf({arrayBuffer:async()=>new ArrayBuffer(0)}),destroyed:()=>destroyed,cleaned:()=>cleaned};
}
const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
const page=(sku,name,qty)=>[item('Dari: IGNORE',30,800),item('SKU',30,720),item('Nama Produk',160,720),item('Jumlah',400,720),item('Catatan',460,720),item(sku,30,695),item(name,160,695),item(qty,400,695),item('IGNORE NOTE',460,695)];
test('Form Input and Import PDF share multi-page parser without requiring a transfer header',async()=>{
 const reader=parser([page('001','PDF NAME WHITE','8'),page('002','PDF NAME GOLD','2')]),out=await reader.read();
 assert.equal(out.pageCount,2);assert.equal(out.failedRows.length,0);assert.deepEqual(JSON.parse(JSON.stringify(out.items.map(({sku,namaProduk,qty})=>({sku,namaProduk,qty})))),[{sku:'001',namaProduk:'PDF NAME WHITE',qty:8},{sku:'002',namaProduk:'PDF NAME GOLD',qty:2}]);assert.equal(reader.cleaned(),2);assert.equal(reader.destroyed(),1);
});
test('shared PDF reader releases resources when page extraction fails',async()=>{
 let destroyed=false;const context=vm.createContext({window:{pdfjsLib:{getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>{throw new Error('Invalid PDF page');}}),destroy:async()=>{destroyed=true;}})}}});
 vm.runInContext(source.slice(source.indexOf('function getPdfJsLib(){'),source.indexOf('function isSkuCandidate')),context);
 await assert.rejects(()=>context.readTransferPdf({arrayBuffer:async()=>new ArrayBuffer(0)}),/Invalid PDF page/);assert.equal(destroyed,true);
});
