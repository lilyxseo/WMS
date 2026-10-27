import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
function analysis(quantities,{selectedTo=[],storageFails=false}={}){
 const today=new Date().toISOString().slice(0,10),rows=quantities.map((qty,i)=>({sku:`SKU ${i}`,namaBarang:`Merlyn ${i}`,qty,tanggal:today,to:'STORE WHITE #1'}));
 const context=vm.createContext({Date,Map,Set,Math,Number,JSON,DATA:{'Kartu Stock':[]},ABC_ANALYSIS_CACHE_KEY:'test',getBarangKeluarRows:()=>rows,getBarangMasukRows:()=>[],getVal:(row,keys)=>keys.map(key=>row[key]).find(value=>value!==undefined),parseNumber:Number,clean:value=>String(value).trim().toLowerCase(),localStorage:{setItem(){if(storageFails)throw Error('quota');}}});
 vm.runInContext(source.slice(source.indexOf('const ABC_STATE='),source.indexOf('function getAbcRenderSignature')),context);
 context.selectedTo=selectedTo;vm.runInContext('ABC_STATE.selectedTo=selectedTo;',context);
 return {context,rows,build:()=>vm.runInContext('buildAbcAnalysis()',context)};
}
test('dominant SKU stays A and threshold-crossing items complete their category',()=>{
 const {build}=analysis([90,8,2]);assert.deepEqual(Array.from(build().rows,row=>[row.sku,row.abc]),[['SKU 0','A'],['SKU 1','B'],['SKU 2','C']]);
 const exact=analysis([80,15,5]).build();assert.deepEqual(Array.from(exact.top10,row=>row.abc),['A','B','C']);assert.equal(exact.top10.at(-1).cum,1);
 assert.equal(analysis([1]).build().rows[0].abc,'A');
});
test('future, rejected and nonpositive transactions do not change category volume',()=>{
 const {rows,build}=analysis([10]);rows.push({...rows[0],qty:999,tanggal:'2999-01-01'},{...rows[0],qty:50,to:'REJECT STORE'},{...rows[0],qty:-10});assert.equal(build().rows[0].qtyKeluar,10);
});
test('destination names retain spaces and punctuation, and cache quota does not prevent analysis',()=>{
 const data=analysis([10],{selectedTo:['STORE WHITE #1'],storageFails:true}).build();assert.equal(data.rows.length,1);assert.equal(data.rows[0].qtyKeluar,10);
});
test('SKU search and category filters preserve the full-population ABC classification',()=>{
 const {context,build}=analysis([80,15,5]);context.data=build();vm.runInContext('ABC_STATE.rows=data.rows;',context);
 const start=source.indexOf('function getAbcVisibleRows()');vm.runInContext(source.slice(start,source.indexOf('function exportAbcCsv',start)),context);
 vm.runInContext('ABC_STATE.search="merlyn 1";ABC_STATE.category="B";',context);assert.deepEqual(Array.from(vm.runInContext('getAbcVisibleRows()',context),row=>row.sku),['SKU 1']);assert.equal(vm.runInContext('ABC_STATE.rows.length',context),3);
});

test('stock coverage uses period demand and missing stock is never treated as zero',()=>{
 const {context,build}=analysis([90,90,90,90,90]);
 context.DATA['Kartu Stock']=[{sku:'SKU 0','stok akhir':0},{sku:'SKU 1','stok akhir':7},{sku:'SKU 2','stok akhir':20},{sku:'SKU 3','stok akhir':100}];
 const bySku=new Map(build().rows.map(row=>[row.sku,row]));
 assert.equal(bySku.get('SKU 0').rekom,'SEGERA ORDER');assert.equal(bySku.get('SKU 1').coverage,7);
 assert.equal(bySku.get('SKU 2').rekom,'RESTOCK PRIORITAS');assert.equal(bySku.get('SKU 3').rekom,'TINJAU STOK BERLEBIH');
 assert.equal(bySku.get('SKU 4').stokSaatIni,null);assert.equal(bySku.get('SKU 4').coverage,null);assert.equal(bySku.get('SKU 4').rekom,'CEK DATA STOK');
});
test('frequency counts valid period outbound rows and ignores historic receipts',()=>{
 const {context,rows,build}=analysis([10]);rows.push({...rows[0],qty:20},{...rows[0],qty:50,to:'REJECT'},{...rows[0],tanggal:'2000-01-01'});
 context.getBarangMasukRows=()=>Array.from({length:100},()=>({sku:'SKU 0'}));const item=build().rows[0];assert.equal(item.frekuensi,2);assert.equal(item.qtyKeluar,30);
});
test('comma searches combine SKU alternatives and stock conditions do not change ABC classes',()=>{
 const {context,build}=analysis([80,15,5]);context.data=build();vm.runInContext('ABC_STATE.rows=data.rows;',context);
 const start=source.indexOf('function getAbcVisibleRows()');vm.runInContext(source.slice(start,source.indexOf('function exportAbcCsv',start)),context);
 vm.runInContext('ABC_STATE.search="SKU 0, merlyn 2";ABC_STATE.attention="unknown";',context);
 assert.deepEqual(Array.from(vm.runInContext('getAbcVisibleRows()',context),row=>row.sku),['SKU 0','SKU 2']);assert.equal(vm.runInContext('ABC_STATE.rows[0].abc',context),'A');
 vm.runInContext('ABC_STATE.attention="empty";',context);assert.equal(vm.runInContext('getAbcVisibleRows().length',context),0);
});

test('refresh repopulates rows even when recomputed data matches the previous signature',()=>{
 const {context,build}=analysis([80,15,5]);context.data=build();context.authRequestGeneration=1;context.setTimeout=fn=>fn();context.updateAbcLoadingUi=()=>{};context.updateAbcSummaryAndBodyOnly=()=>{};context.updateAbcToOptionsOnly=()=>{};
 vm.runInContext(source.slice(source.indexOf('function getAbcRenderSignature'),source.indexOf('function renderAbcAnalisisPage')),context);
 vm.runInContext('syncAbcStateFromData(data);ABC_STATE.rows=[];ABC_STATE.generatedAt=0;scheduleAbcBackgroundCompute();',context);
 assert.equal(vm.runInContext('ABC_STATE.rows.length',context),3);assert.equal(vm.runInContext('ABC_STATE.bgComputing',context),false);
});
test('blank stock values are unavailable while a recorded numeric zero is retained',()=>{
 const {context,build}=analysis([10,10]);context.DATA['Kartu Stock']=[{sku:'SKU 0','stok akhir':''},{sku:'SKU 1','stok akhir':'0'}];const rows=new Map(build().rows.map(row=>[row.sku,row]));assert.equal(rows.get('SKU 0').stokSaatIni,null);assert.equal(rows.get('SKU 1').stokSaatIni,0);
});
