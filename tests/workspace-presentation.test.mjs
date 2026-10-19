import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../assets/js/main.js',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const esc=value=>String(value??'').replaceAll('<','&lt;');
test('column presentation identifies quantities without treating dates, statuses or stockout as numbers',()=>{
 const context=vm.createContext({});vm.runInContext(between('function workspaceColumnKind','function polishWorkspaceTables'),context);
 for(const name of ['Qty','Stok Akhir ▾','Jumlah SKU','Selisih'])assert.equal(context.workspaceColumnKind(name),'number');
 for(const name of ['Stockout','Tanggal','Status'])assert.equal(context.workspaceColumnKind(name),'');
 assert.equal(context.workspaceColumnKind('SKU'),'sku');assert.equal(context.workspaceColumnKind('Lokasi / Sumber'),'location');
});
test('dashboard prioritizes operations and preserves every metric',()=>{
 const context=vm.createContext({esc});vm.runInContext(between('function dashboardMetricsMarkup','function updateDashboardAttention'),context);
 const html=context.dashboardMetricsMarkup([{name:'Total SKU',value:5000},{name:'Barang Keluar',value:20},{name:'Barang Masuk',value:10},{name:'Stok Minus',value:2}]);
 assert.ok(html.indexOf('Barang Masuk')<html.indexOf('Barang Keluar'));assert.ok(html.indexOf('Stok Minus')<html.indexOf('Total SKU'));assert.equal((html.match(/class='metric'/g)||[]).length,4);assert.ok(html.includes('5.000'));
});
test('compact dashboard keeps the remaining insights available in a disclosure',()=>{
 const context=vm.createContext({esc});vm.runInContext(between('function renderInsightCard','function normalizeStatus'),context);
 const html=context.renderInsightCard({insights:Array.from({length:7},(_,i)=>({text:`Insight ${i}`}))});
 const [visible,extra]=html.split('<details');assert.equal((visible.match(/<li /g)||[]).length,3);assert.equal((extra.match(/<li /g)||[]).length,4);assert.ok(extra.includes('Lihat 4 insight lainnya'));
});
test('dashboard recent section renders ten rows and retains navigation to the complete ledger',()=>{
 let received;const context=vm.createContext({esc,renderDashboardSheetTable:rows=>{received=rows;return 'table';}});
 vm.runInContext(between('function renderDashboardTableSection','function renderDashboardSheetTable'),context);
 const html=context.renderDashboardTableSection('Barang Masuk','',Array.from({length:50},(_,i)=>i),'');assert.equal(received.length,10);assert.equal(received[9],9);assert.ok(html.includes('/barang-masuk'));assert.ok(html.includes('Lihat semua'));
});
