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
 const context=vm.createContext({esc});vm.runInContext(between('function dashboardMetricsMarkup','function updateDashboard(){'),context);
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
test('SKU navigation opens the full page and keeps browser history',()=>{
 const routes=[],history={pushState:(_state,_title,path)=>routes.push(path)};
 const context=vm.createContext({location:{pathname:'/search'},history,user:null,routeFromPath:path=>routes.push('route:'+path)});
 vm.runInContext(between('function navigateTo(path)','function navigateToSku'),context);
 context.navigateTo('/sku/ABC');assert.deepEqual(routes,['/sku/ABC','route:/sku/ABC']);
 assert.doesNotMatch(source,/openSkuPreview|skuPreviewDialog/);
});
test('shared table decoration preserves the dedicated Balikan table layout',()=>{
 const context=vm.createContext({});vm.runInContext(between('function polishWorkspaceTables','function polishWorkspaceTools'),context);
 let decorated=false;
 const table={matches:selector=>['table','.balikan-table'].includes(selector),querySelectorAll:()=>[],closest:()=>null,classList:{add:()=>{decorated=true;}}};
 context.polishWorkspaceTables(table);assert.equal(decorated,false);
});
test('dashboard compact transactions retain SKU, quantity and all nine ledger fields',()=>{
 const context=vm.createContext({esc,getVal:(row,keys)=>keys.map(key=>row[key]).find(value=>value!==undefined)||''});
 vm.runInContext(between('function renderDashboardSheetTable','function normMv'),context);
 const html=context.renderDashboardSheetTable([{tanggal:'2026-10-27',from:'FROM-A',to:'TO-B',sku:'00123',namaBarang:'PRODUCT-X',qty:7,status:'STATUS-X',pic:'PIC-X',keterangan:'NOTE-X'}],'Barang Masuk');
 const [table,mobile]=html.split('<div class=\'dashboard-mobile-list\'>');
 for(const value of ['2026-10-27','FROM-A','TO-B','00123','PRODUCT-X','7','STATUS-X','PIC-X','NOTE-X']){assert.ok(table.includes(value));assert.ok(mobile.includes(value));}
 assert.match(mobile,/<details>/);assert.match(mobile,/navigateToSku/);assert.equal((table.match(/<th>/g)||[]).length,9);
});
test('dashboard view preference applies to both transaction sections',()=>{
 const sections=Array.from({length:2},()=>({dataset:{},buttons:['cards','table'].map(mode=>({dataset:{dashboardMode:mode},setAttribute(name,value){this[name]=value;}})),querySelectorAll(){return this.buttons;}}));const context=vm.createContext({window:{},document:{querySelectorAll:()=>sections}});
 vm.runInContext(between("let dashboardTransactionView=",'function renderDashboardTableSection'),context);context.window.setDashboardTransactionView('table');
 for(const section of sections){assert.equal(section.dataset.dashboardView,'table');assert.equal(section.buttons[1]['aria-pressed'],'true');}
 context.window.setDashboardTransactionView('invalid');assert.equal(sections[0].dataset.dashboardView,'cards');
});
