import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const frontend = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const endpoint = await readFile(new URL('../functions/api/inventory-version.js', import.meta.url), 'utf8');

test('inventory version endpoint returns metadata only and remains authenticated', () => {
  assert.match(endpoint, /getRequestRole/);
  assert.match(endpoint, /barangMasukVersion/);
  assert.match(endpoint, /barangKeluarVersion/);
  assert.match(endpoint, /rplVersion/);
  assert.match(endpoint, /bulkyVersion/);
  assert.match(endpoint, /rpc\/inventory_client_versions/);assert.doesNotMatch(endpoint,/count=exact|order=synced_at/);
  assert.doesNotMatch(endpoint, /select=\*/);
});

test('version watcher pauses when hidden or offline and checks lifecycle signals', () => {
  assert.match(frontend, /INVENTORY_VERSION_CHECK_INTERVAL_MS=10\*1000/);
  assert.match(frontend, /document\.hidden\|\|navigator\.onLine===false/);
  assert.match(frontend, /visibilitychange/);
  assert.match(frontend, /window\.addEventListener\('focus'/);
  assert.match(frontend, /window\.addEventListener\('online'/);
  assert.match(frontend, /window\.addEventListener\('offline'/);
});

test('route refresh is scoped, abortable, and preserves transaction view state', () => {
  assert.match(frontend, /clearSource\('barang_masuk'\)/);
  assert.match(frontend, /clearSource\('barang_keluar'\)/);
  assert.match(frontend, /page:TABLE_STATE\.in\.page,force:true,background:true/);
  assert.match(frontend, /page:TABLE_STATE\.out\.page,force:true,background:true/);
  assert.match(frontend, /rerenderTableWithScrollRestore\(mode,true\)/);
  assert.match(frontend, /new AbortController\(\)/);
  assert.match(frontend, /generation!==INVENTORY_VERSION_STATE\.generation/);
  assert.doesNotMatch(frontend.slice(frontend.indexOf('async function checkInventoryVersion'), frontend.indexOf('async function loadAllData')), /location\.reload|mode=full/);
});

const vm=await import('node:vm');
test('lightweight entry routes start version monitoring before returning without warehouse hydration',async()=>{
 const code=frontend.slice(frontend.indexOf('async function initAppData()'),frontend.indexOf('async function refreshDataInBackground()'));
 for(const path of ['/','/dashboard','/barang-masuk','/barang-keluar','/search','/warning','/sku/SKU1']){
  let watchers=0,hydrations=0;
  const context=vm.createContext({hasInitializedDataFlow:false,startInventoryVersionWatcher:()=>watchers++,console:{log(){},error(){}},location:{pathname:path},window:{},startInitialPrefetch(){},loadInventorySyncStatus:async()=>{},hideInitialLoader(){},setMainContentLoading(){},hydrateModuleCachesFromDb:async()=>hydrations++});
  vm.runInContext(code,context);await context.initAppData();await context.initAppData();assert.equal(watchers,1,path);assert.equal(hydrations,0,path);
 }
});
function visibleContext(page){const calls=[];const context=vm.createContext({getActivePage:()=>page,INVENTORY_VERSION_STATE:{generation:1},STOCK_AGING_STATE:{},STATS_STATE:{},captureActivePageScroll:()=>({top:77}),restoreActivePageScroll:async(p,s)=>calls.push(['scroll',p,s.top]),setRefreshIndicator:()=>{},refreshDashboard:async()=>calls.push(['dashboard']),refreshWarning:async()=>calls.push(['warning']),TRANSACTION_PAGE_CACHE:{clearSource:source=>calls.push(['clear',source])},TABLE_STATE:{in:{page:3},out:{page:2}},loadTransactionTablePage:async(mode,options)=>calls.push([mode,options])});vm.runInContext(frontend.slice(frontend.indexOf('async function refreshVisibleInventoryPage'),frontend.indexOf('function inventoryAutoRefreshBlocked')),context);return {context,calls};}
test('external spreadsheet version updates reload transaction data preserving its page and scroll',async()=>{
 const {context,calls}=visibleContext('barang-masuk');await context.refreshVisibleInventoryPage(['barangMasukVersion'],1);
 assert.equal(calls[1][0],'in');assert.equal(calls[1][1].page,3);assert.equal(calls[1][1].force,true);assert.equal(calls[1][1].background,true);assert.deepEqual(calls[2],['scroll','barang-masuk',77]);
});
test('dashboard and warning watcher refreshes use their working invalidation paths',async()=>{
 const dashboard=visibleContext('dashboard');await dashboard.context.refreshVisibleInventoryPage(['barangMasukVersion'],1);assert.equal(dashboard.calls[0][0],'dashboard');
 const warning=visibleContext('anomaly');await warning.context.refreshVisibleInventoryPage(['warningVersion'],1);assert.equal(warning.calls[0][0],'warning');
 const unrelated=visibleContext('sheet-input');assert.equal(await unrelated.context.refreshVisibleInventoryPage(['barangMasukVersion'],1),false);assert.equal(unrelated.calls.length,0);
});
test('dashboard revalidation discards old fulfilled promises before fetching all sections',async()=>{
 const old=Promise.resolve('old');let loads=0,aborted=0;const requests={generation:1,summary:old,recent:old,insight:old,controllers:{summary:{abort(){aborted++;}}}};
 const context=vm.createContext({DASHBOARD_REQUESTS:requests,loadDashboardPayload:async()=>{assert.equal(requests.summary,null);assert.equal(requests.recent,null);assert.equal(requests.insight,null);loads++;}});
 vm.runInContext(frontend.slice(frontend.indexOf('async function refreshDashboard()'),frontend.indexOf('async function refreshTransactionPage')),context);await context.refreshDashboard();assert.equal(loads,1);assert.equal(aborted,1);assert.equal(requests.generation,2);
});

test('direct spreadsheet pages revalidate while visible and defer during editing, offline or hidden',async()=>{
 for(const page of ['balikan-store','asset-store','arsip','barang-reject','movement','cycle-count']){
  let now=100000,refreshes=0,editing=false;const state={page:'',checkedAt:0,inFlight:false};const document={hidden:false},navigator={onLine:true};
  const context=vm.createContext({user:{id:'alice'},document,navigator,SPREADSHEET_LIVE_STATE:state,inventoryAutoRefreshBlocked:()=>editing,hasBalikanUnfinishedLocalChange:()=>false,getActivePage:()=>page,Date:{now:()=>now},REFRESH_STATE:{isRefreshing:false},isSyncing:false,authRequestGeneration:1,captureActivePageScroll:()=>({}),restoreActivePageScroll:async()=>{},SOFT_REFRESH_ROUTES:{[page]:async()=>refreshes++},console});
  vm.runInContext(frontend.slice(frontend.indexOf('async function refreshVisibleSpreadsheetPage()'),frontend.indexOf('function startInventoryVersionWatcher()')),context);
  await context.refreshVisibleSpreadsheetPage();assert.equal(refreshes,0);now+=61000;editing=true;await context.refreshVisibleSpreadsheetPage();assert.equal(refreshes,0);editing=false;document.hidden=true;await context.refreshVisibleSpreadsheetPage();assert.equal(refreshes,0);document.hidden=false;navigator.onLine=false;await context.refreshVisibleSpreadsheetPage();assert.equal(refreshes,0);navigator.onLine=true;await context.refreshVisibleSpreadsheetPage();assert.equal(refreshes,1,page);await context.refreshVisibleSpreadsheetPage();assert.equal(refreshes,1,page);
 }
});

test('Asset Store background revalidation preserves pagination and search filters',async()=>{
 const state={selectedSheet:'Asset',page:4,search:'MERLYN',sortColumn:'SKU',cache:{Asset:{rows:[]},Other:{rows:[]}}};
 const context=vm.createContext({ASSET_STORE_STATE:state,renderAssetStorePage(){}});
 vm.runInContext(frontend.slice(frontend.indexOf('async function selectAssetStoreSheet('),frontend.indexOf('async function refreshAssetStore()')),context);
 await context.selectAssetStoreSheet('Asset',{preservePage:true});assert.equal(state.page,4);assert.equal(state.search,'MERLYN');assert.equal(state.sortColumn,'SKU');
 await context.selectAssetStoreSheet('Other');assert.equal(state.page,1);
});
