import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../assets/js/main.js',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
 constructor(){this.children=[];this.dataset={};this.attributes=new Map();this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};}
 set innerHTML(value){this.html=value;this.children=[];}get innerHTML(){return this.html||'';}
 appendChild(child){child.parent=this;this.children.push(child);}replaceChildren(...children){this.children=children;}
 querySelector(){return this.children.find(child=>Object.hasOwn(child.dataset,'pageDataStatus'))||null;}
 setAttribute(k,v){this.attributes.set(k,v);}removeAttribute(k){this.attributes.delete(k);}toggleAttribute(k,on){if(on)this.setAttribute(k,'');else this.removeAttribute(k);}
 addEventListener(){}remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
}
function routeFixture(){
 const pages=new Map(['dashboard','search','stats','abc-analisis','stok-minus','cycle-count','movement','balikan-store','activity-log','settings','import-pdf-transfer','sheet-input','anomaly'].map(name=>[name,new Element()]));
 for(const root of pages.values()){root.classes.add('hidden');root.innerHTML='<h3>Judul</h3><input class="control">';}
 const pending=new Map(),events=[];
 const ctx=vm.createContext({console:{error(){}},window:{__isDataReady:false},document:{getElementById:id=>pages.get(id.replace('page-','')),querySelectorAll:selector=>selector==='.page'?[...pages.values()]:[],createElement:()=>new Element()},LOADED_DETAIL_PAGES:new Set(),DASHBOARD_SUMMARY:{},SEARCH_STATE:{minChars:2},getActivePage:()=>[...pages].find(([,root])=>!root.classes.has('hidden'))?.[0],syncBalikanShortcutListeners(){},setupBalikanEntry(){},closeScannerModal(){},syncActiveSidebarParent(){},invalidateInactiveTransactionRequests(){},setMainContentLoading(){},pageLog(){},renderState(){},restoreSearchResults(){},loadDetailPageData:page=>{events.push('load:'+page);return new Promise((resolve,reject)=>pending.set(page,{resolve,reject}));}});
 ctx.rerenderCurrentPage=()=>{const page=ctx.getActivePage();events.push('render:'+page);const root=pages.get(page);root.innerHTML='<h3>Judul</h3><input class="control">';ctx.renderPageDataStatus(page);};
 vm.runInContext(between('const PAGE_DATA_LOADS=','function pageTitleFromPath'),ctx);
 return {ctx,pages,pending,events};
}
test('page structures appear before delayed data, and repeated navigation shares the pending request',async()=>{
 for(const page of ['abc-analisis','stok-minus','cycle-count','movement','balikan-store']){
  const f=routeFixture();f.ctx.showPage(page);
  assert.match(f.pages.get(page).innerHTML,/input class="control"/);assert.equal(f.pages.get(page).classes.has('hidden'),false);
  assert.deepEqual(f.events,['render:'+page]);
  await tick();f.ctx.showPage(page);await tick();assert.equal(f.events.filter(x=>x==='load:'+page).length,1);
  f.pending.get(page).resolve();await tick();assert.equal(f.pages.get(page).querySelector(),null);assert.ok(f.ctx.LOADED_DETAIL_PAGES.has(page));
 }
});
test('delayed responses do not rerender or hide the page visited afterward',async()=>{
 const f=routeFixture();f.ctx.showPage('movement');await tick();f.ctx.showPage('search');const before=f.events.length;
 f.pending.get('movement').resolve();await tick();assert.equal(f.events.length,before);assert.equal(f.pages.get('search').classes.has('hidden'),false);
});
test('data failures settle the loading state and retry without hiding controls',async()=>{
 const f=routeFixture();f.ctx.showPage('cycle-count');await tick();f.pending.get('cycle-count').reject(new Error('Offline'));await tick();
 const status=f.pages.get('cycle-count').querySelector();assert.ok(status.children.some(child=>child.textContent.includes('Offline')));
 assert.equal(f.pages.get('cycle-count').attributes.has('data-data-loading'),false);assert.match(f.pages.get('cycle-count').innerHTML,/control/);
 status.children.find(child=>child.textContent==='Coba lagi').onclick();await tick();assert.equal(f.events.filter(x=>x==='load:cycle-count').length,2);
 f.pending.get('cycle-count').resolve();await tick();assert.equal(f.pages.get('cycle-count').querySelector(),null);
});
test('independent page structures never start full-table hydration',async()=>{
 for(const page of ['settings','anomaly','activity-log','import-pdf-transfer','sheet-input']){
  const f=routeFixture();f.ctx.showPage(page);await tick();assert.deepEqual(f.events,['render:'+page]);
 }
});
test('startup loading cannot conceal the content container and the full-page skeleton is removed',()=>{
 const shell=new Element(),skeleton=new Element();
 const ctx=vm.createContext({mainContentPages:shell,mainContentSkeleton:skeleton});
 vm.runInContext(between('function setMainContentLoading','function initDashboard'),ctx);ctx.setMainContentLoading(true);
 assert.equal(shell.classes.has('hidden'),false);assert.equal(skeleton.classes.has('hidden'),true);assert.doesNotMatch(html,/id="mainContentSkeleton"/);
});
function agingFixture(){
 const root=new Element(),elements=new Map();
 const state={rows:[],summary:{},loading:true,loaded:false,error:'',bucket:'all',sort:'oldest',page:1,pageSize:25,search:''};
 const ctx=vm.createContext({stockAgingApp:root,STOCK_AGING_STATE:state,STOCK_AGING_LABELS:{active:'Aktif'},window:{},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}},esc:x=>String(x),stockAgingFilteredRows:()=>state.rows,stockAgingBadge:()=>'<span>Aktif</span>',formatDateTime:()=>'',encAttr:x=>x,bindStockAgingEvents(){},loadStockAging(){}});
 vm.runInContext(between('function renderDataSkeletonRows','function renderPageDataStatus'),ctx);
 vm.runInContext(between('function renderStockAgingBody','function bindStockAgingEvents'),ctx);
 return {ctx,state,root};
}
test('Stock Aging preserves filters and table headings during loading and failures',()=>{
 const f=agingFixture();f.ctx.renderStockAgingBody();assert.match(f.root.innerHTML,/id='agingSearch'/);assert.match(f.root.innerHTML,/<th>SKU \/ Barang<\/th>/);assert.match(f.root.innerHTML,/mv-skeleton-row/);
 f.state.error='Offline';f.state.loading=false;f.ctx.renderStockAgingBody();assert.match(f.root.innerHTML,/id='agingSearch'/);assert.match(f.root.innerHTML,/<th>Lokasi<\/th>/);assert.match(f.root.innerHTML,/id='agingRetry'/);assert.doesNotMatch(f.root.innerHTML,/mv-skeleton-row/);
});
test('cached Stock Aging rows remain visible during a background refresh',()=>{
 const f=agingFixture();f.state.loaded=true;f.state.rows=[{sku:'001',namaBarang:'Pump',stock:4,locations:['A1'],lastMovement:'2026-10-12',daysSinceMovement:0,bucket:'active'}];
 f.ctx.renderStockAgingBody();assert.match(f.root.innerHTML,/Pump/);assert.match(f.root.innerHTML,/Memperbarui/);assert.doesNotMatch(f.root.innerHTML,/mv-skeleton-row/);
});
test('Reject loading preserves the transaction toolbar and column headings',()=>{
 const root=new Element(),state={activeTab:'masuk',loading:true,lastSync:0,stock:[],masuk:[],keluar:[],filters:{masukSearch:''}};
 const ctx=vm.createContext({getActivePage:()=> 'barang-reject',rejectEntryController:null,filteredRejectRows:()=>[],BARANG_REJECT_STATE:state,REJECT_IN_COLUMNS:[['SKU'],['Qty']],document:{getElementById:id=>id==='barangRejectApp'?root:new Element(),querySelectorAll:()=>[]},window:{},getBarangRejectNavPage:()=>'',canCrud:()=>true,syncActiveSidebarParent(){},ensureBarangRejectLoaded(){},renderRejectToolbar:()=>'<input id="rejectSearch">',orderRejectSheetRows:r=>r,paginateReject:r=>r,thRejectStatic:x=>`<th>${x}</th>`,rejectPager:()=>'',bindBarangRejectEvents(){},esc:x=>x});
 vm.runInContext(between('function renderDataSkeletonRows','function renderPageDataStatus'),ctx);
 vm.runInContext(between('function renderRejectIn','function renderRejectOut'),ctx);
 vm.runInContext(between('function renderBarangRejectPage','\n',),ctx);
 ctx.renderBarangRejectPage();assert.match(root.innerHTML,/rejectSearch/);assert.match(root.innerHTML,/<th>SKU<\/th>/);assert.match(root.innerHTML,/mv-skeleton-row/);
});

test('independent inventory sources are fetched together without waiting for the first source',async()=>{
 const pending=new Map(),started=[];
 const ctx=vm.createContext({window:{},console:{log(){},time(){},timeEnd(){}},INVENTORY_PRELOAD_SHEETS:['Kartu Stock','RPL','BULKY'],fetchSheet:sheet=>{started.push(sheet);return new Promise(resolve=>pending.set(sheet,resolve));},scheduleUIWork:cb=>cb(),routeFetchedSourceRows:(sheet,raw)=>raw});
 vm.runInContext(between('function preloadMainData','async function fetchUserProfile'),ctx);
 const read=ctx.preloadMainData();assert.deepEqual(started,['Kartu Stock','RPL','BULKY']);
 pending.get('BULKY')(['b']);pending.get('RPL')(['r']);assert.equal(ctx.window.mainDataCache,undefined);pending.get('Kartu Stock')(['k']);
 const data=await read;assert.deepEqual(JSON.parse(JSON.stringify(data)),{'Kartu Stock':['k'],RPL:['r'],BULKY:['b']});
});

class ActivityDom extends Element {
 set innerHTML(value){super.innerHTML=value;this.assignments=(this.assignments||0)+1;this.regions=new Map();this.controls=new Map();
  if(value.includes('activity-filters'))this.regions.set('.activity-filters',new Element());
  for(const selector of ['.activity-summary','.activity-panel-heading > span','.activity-pagination','#activityDataError'])this.regions.set(selector,new Element());
  const tbody=new Element();tbody.innerHTML=value.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1]||'';this.regions.set('.activity-table-wrap tbody',tbody);
  for(const [,id] of value.matchAll(/id="([^"]+)"/g)){const el=new Element();el.value='';this.controls.set(id,el);}
 }
 get innerHTML(){return super.innerHTML;}
 querySelector(selector){return this.regions?.get(selector)||null;}
}
test('Activity Log shows controls while pending and updates only data without discarding filter drafts',async()=>{
 const root=new ActivityDom(),controls=new Map();let finish;
 const state={page:1,pageSize:25,filters:{action:'',status:'',search:'',module:'',user:'',from:''}};
 const ctx=vm.createContext({ACTIVITY_LOG_STATE:state,authRequestGeneration:1,getActivePage:()=>'activity-log',fetchActivityLogs:()=>new Promise(resolve=>finish=resolve),esc:x=>String(x),formatDateTime:()=>'',activityBadge:x=>x,activityDetail:x=>x.detail||'',document:{getElementById:id=>{if(id==='activityLogApp')return root;if(root.controls?.has(id))return root.controls.get(id);if(!controls.has(id))controls.set(id,new Element());return controls.get(id);},createElement:()=>new ActivityDom(),querySelectorAll:()=>[]}});
 vm.runInContext(between('function renderDataSkeletonRows','function renderPageDataStatus'),ctx);
 vm.runInContext(between('let activityLogRequestId','window.showToast'),ctx);
 const read=ctx.renderActivityLogPage();assert.match(root.innerHTML,/id="alSearch"/);assert.match(root.innerHTML,/<th>User<\/th>/);assert.match(root.regions.get('.activity-table-wrap tbody').innerHTML,/mv-skeleton-row/);
 const field=root.controls.get('alSearch');field.value='draft query';const action=root.controls.get('alAction');action.value='UPDATE';
 finish([{user_name:'Tester',created_at:new Date().toISOString(),action:'CREATE',status:'SUCCESS',module:'Movement'}]);await read;
 assert.equal(root.assignments,1);assert.equal(root.controls.get('alSearch'),field);assert.equal(field.value,'draft query');assert.equal(action.value,'UPDATE');assert.match(root.regions.get('.activity-table-wrap tbody').innerHTML,/Tester/);
});
