import { restoreSession, getAuthenticatedUser, bindLogoutButtons, loginWithEmailPassword, supabase, getAuthHeaders } from "./supabase.js";
import { API_KEY, SPREADSHEET_ID, SHEETS, FILTERS, APP_CONFIG, SIGNUP_ACCESS_PASSWORD } from "./config.js";
import { buildAutoInsight } from "./utils/insight-helper.js";
import { logActivity, logActivityResult, logLogin, logLogout, logPageView } from "./activity-log.js";
import { TransactionPageCache, transactionPageKey, transactionSummaryKey } from "./transaction-page-cache.js";
const ids=["searchInput","quickResultCard","statsFilter","refreshToggleHeader","darkBtnHeader","openSidebar","closeSidebar","sidebarOverlay","sheetInfo","spreadsheetInfo","dashboardCards","recentMove","statsCards","statsChart","loadedState","countPerSheet","filterRow","lastSync","settingsApiState","sidebarApi","detail","locationsSummary","locSearchInput","locStatusFilter","locTypeFilter","locSort","locPageSize","locationsTable","locationsEmpty","locationDetail","inSearch","inResults","outSearch","outResults","inFiltersToggle","outFiltersToggle","anomalySummary","anomalySeverity","anomalyType","anomalySource","anomalySearch","anomalyTable","stokMinusSummary","stokMinusPanel","stokMinusTable","cycleCountApp","movementApp","settingsLastRefresh","settingsTotalRows","settingsSystemStatus","settingsSystemDot","settingsDataSources","settingsCacheStatus","settingsCacheTime","archiveApp","assetStoreApp","mainContentSkeleton","mainContentPages","sidebarToggle","balikanSheetSelect","balikanSearchInput","balikanSummary","balikanTable","btnScanBalikan","balikanSortSelect","btnResetBalikanFilter","btnExportBalikanCsv","balikanAutoCheckToggle","balikanSearchHistory","abcAnalisisApp","importPdfTransferApp","barangRejectApp","rejectPermissionBadge"];
ids.forEach(id=>window[id]=document.getElementById(id));
const statusEl=document.getElementById("status");
const ANOMALY_CACHE_KEY="anomalyCacheV1";
const CACHE_KEYS={lastSync:"inventory_last_sync",version:"inventory_cache_version",searchHistory:"inventory_recent_search",balikanSearchHistory:"inventory_balikan_store_search_history"};
const SIDEBAR_MENU_STATE_KEY="inventory_sidebar_menu_state";
const MODULE_CACHE_KEYS={inventory:"inventoryCache",movement:"movementCache",barangMasuk:"barangMasukCache",barangKeluar:"barangKeluarCache",kartuStock:"kartuStockCache",rpl:"rplCache",bulky:"bulkyCache",balikanStore:"balikanStoreCache",cycleCount:"cycleCountCache",activityLog:"activityLogCache"};
const ABC_ANALYSIS_CACHE_KEY="ABC_ANALYSIS_CACHE";
const CACHE_VERSION="2";
const AUTO_SYNC_INTERVAL_MS=5*60*1000;
const AUTO_SYNC_CHECK_INTERVAL_MS=30*1000;
const INVENTORY_VERSION_CHECK_INTERVAL_MS=45*1000;
const IDB_NAME="inventory_cache_db";
const IDB_VERSION=1;
const IDB_STORE="sheets";
const DATA = {}; let CACHE_SKU = new Map(); let currentFilter="Semua", lastResults=[], lastQuery="", selectedQuickSku="", apiConnected=false, currentSku="", isSyncing=false, searchModalOpen=false, prevRouteBeforeSearch="/";
const REFRESH_STATE={isRefreshing:false,lastRefreshAt:0,refreshQueue:[],dataVersion:0,cacheVersion:0,modules:{},pendingRenderModules:new Set(),refreshPromise:null};
window.REFRESH_STATE=REFRESH_STATE;
let manualRefreshNoticeTimer=null;
let isDevAutoRefreshRunning=false;
let isDevAutoRefreshingNow=false;
let devAutoRefreshTimer=null;
let devAutoRefreshCount=0;
let devAutoRefreshLastTs=0;
let devAutoRefreshLastError="";
const scheduleManualRefreshRender=debounce((mode)=>{
if(mode==='in'||mode==='out')rerenderTableWithScrollRestore(mode,true);
},180);
const BARCODE_STATE={barcodeToSku:new Map(),barcodeToName:new Map(),loaded:false,updatedAt:0};
const SEARCH_STATE={inputValue:"",filterValue:"",page:1,pageSize:50,minChars:2,debounceMs:500,debounceTimer:null,idleTimer:null,abortController:null,runToken:0,lastRenderedHtml:""};
const SCANNER_STATE={instance:null,isScannerRunning:false,isClosing:false,hasScanned:false,targetInputId:"searchInput",resultHandler:null,lastSearchSku:"",lastSearchNavigationAt:0};
const SEARCH_SCAN_NAVIGATION_LOCK_MS=750;
const BALIKAN_AUTO_CHECK_KEY="balikan_auto_check_on_scan";
const BALIKAN_STATE={sheets:[],sheetCache:{},sheetChecksums:{},dynamicColumnCache:{},allTripLoading:false,resetInProgress:false,resetPromise:null,lastRefreshAt:0,highlightRowNumber:null,highlightSheetName:"",sortBy:"default",autoCheckOnScan:true,exactScanSku:"",selectedSkuRowNumber:null,selectedSkuSheetName:"",selectedSkuValue:"",lastCheckedRowId:null,lastCheckedSheetName:"",lastCheckedSku:"",lastCheckedVersion:0,lastCheckedFadeTimer:null,pendingEdits:{},pendingEditMeta:{},saveStatus:{},saveTimer:null,saveInProgress:false,saveRequested:false,isRendering:false,isRefreshing:false,pendingRender:false,lastRenderedChecksum:"",lastDataChecksum:"",lastRenderedHeaderKey:"",renderTimer:null,searchDebounceTimer:null};
const PDF_TRANSFER_STATE={header:{},items:[],warnings:[],debugRows:[],rawText:"",csvText:"",csvRows:[],detectedColumns:[],failedRows:[],logs:[],isParsing:false,isImporting:false,configLoaded:false,configAvailable:false,configError:"",importResult:null,duplicate:null,lastFileName:"",selectedFile:null};
const ACTIVITY_LOG_STATE={page:1,pageSize:25,filters:{module:"",action:"",user:"",status:"",search:"",from:"",to:""}};
const BARANG_REJECT_CACHE_KEY="barangRejectCacheV1";
const barangRejectCacheTTL=5*60*1000;
let barangRejectCache=null;
let isBarangRejectLoading=false;
let lastBarangRejectFetchAt=0;
let barangRejectQuotaToastShown=false;
const BARANG_REJECT_STATE={activeTab:"dashboard",stock:[],masuk:[],keluar:[],lastSync:0,loading:false,refreshing:false,error:"",sort:{key:"qty",dir:"desc"},filters:{stockSearch:"",stockSku:"",stockNama:"",stockLokasi:"",masukSearch:"",masukTanggalFrom:"",masukTanggalTo:"",masukLokasi:"",keluarSearch:"",keluarTanggalFrom:"",keluarTanggalTo:"",keluarStatus:"",keluarPic:""},columnFilters:{masuk:{},keluar:{}},filterDebounceTimer:null,page:{stock:1,masuk:1,keluar:1},pageSize:25,submittingIn:false,submittingOut:false};
if(window.lucide&&typeof window.lucide.createIcons==="function"&&!window.__lucideSafePatched){
const _createIconsOriginal=window.lucide.createIcons.bind(window.lucide);
window.lucide.createIcons=(...args)=>{
try{return _createIconsOriginal(...args);}
catch(err){console.warn("lucide.createIcons skipped:",err?.message||err);return null;}
};
window.__lucideSafePatched=true;
}
const MODULE_CACHE_MEMORY={};
const LARGE_CACHE_KEYS=new Set([MODULE_CACHE_KEYS.inventory,MODULE_CACHE_KEYS.movement,MODULE_CACHE_KEYS.barangMasuk,MODULE_CACHE_KEYS.barangKeluar,MODULE_CACHE_KEYS.kartuStock,MODULE_CACHE_KEYS.rpl,MODULE_CACHE_KEYS.bulky,MODULE_CACHE_KEYS.balikanStore]);
const HAS_INDEXED_DB=typeof window!=="undefined"&&typeof window.indexedDB!=="undefined";
function isLargeCacheKey(key){return LARGE_CACHE_KEYS.has(key);}
async function saveLargeCacheToDb(key,data){
if(!HAS_INDEXED_DB)return;
try{
const db=await openCacheDb();
await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,"readwrite");const st=tx.objectStore(IDB_STORE);st.put({sheet:key,rows:Array.isArray(data)?data:[],updatedAt:Date.now(),version:CACHE_VERSION});tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);});
}catch(err){console.warn("IndexedDB save module cache failed",key,err);}
}
async function loadLargeCacheFromDb(key){
if(!HAS_INDEXED_DB)return [];
try{
const db=await openCacheDb();
const row=await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,"readonly");const rq=tx.objectStore(IDB_STORE).get(key);rq.onsuccess=()=>resolve(rq.result||null);rq.onerror=()=>reject(rq.error);});
return Array.isArray(row?.rows)?row.rows:[];
}catch(err){console.warn("IndexedDB load module cache failed",key,err);return [];} 
}
async function hydrateModuleCachesFromDb(){
for(const key of LARGE_CACHE_KEYS){
const rows=await loadLargeCacheFromDb(key);
if(Array.isArray(rows)&&rows.length)MODULE_CACHE_MEMORY[key]=rows;
}
}
window.BALIKAN_ROWS=[];
window.currentTripSheet="";
window.balikanSearchKeyword="";
let authChecking=true;
let user=null;
let devProfile=null;
let runtimeConfig={previewBypassLogin:false,environment:"unknown"};
let authRequestGeneration=0;
window.mainDataCache=window.mainDataCache||null;
window.mainDataPromise=window.mainDataPromise||null;
let appInitialized=false;
const CURRENT_USER_KEY="user";
function getCurrentUser(){
try{return JSON.parse(localStorage.getItem(CURRENT_USER_KEY)||"{}");}catch(_err){return {};}
}
function currentUserIdentity(){
const current=getCurrentUser()||{};
return {
user_id:String(current.id||current.user_id||user?.id||""),
user_name:String(current.name||current.full_name||current.username||current.email||user?.email||""),
role:String(current.role||current.user_role||"")
};
}
function setCurrentUser(payload){
const normalized=payload&&typeof payload==="object"?payload:{};
localStorage.setItem("currentUser",JSON.stringify(normalized));
localStorage.setItem(CURRENT_USER_KEY,JSON.stringify(normalized));
sessionStorage.setItem("currentUser",JSON.stringify(normalized));
window.currentUser=normalized;
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.currentUser=normalized;
syncDeveloperMenuVisibility();
}
function clearCurrentUser(){
localStorage.removeItem(CURRENT_USER_KEY);
localStorage.removeItem("currentUser");
sessionStorage.removeItem(CURRENT_USER_KEY);
sessionStorage.removeItem("currentUser");
window.currentUser=null;
if(window.APP_STATE){window.APP_STATE.currentUser=null;window.APP_STATE.user=null;window.APP_STATE.authUser=null;}
syncDeveloperMenuVisibility();
}
function isDeveloperUser(){
  const readJson = (storage, key) => {
    try { return JSON.parse(storage.getItem(key) || "null"); } catch (_err) { return null; }
  };
  const sources = [
    window.currentUser,
    window.APP_STATE?.currentUser,
    getCurrentUser(),
    readJson(localStorage, "currentUser"),
    readJson(localStorage, "user"),
    readJson(sessionStorage, "currentUser"),
    readJson(sessionStorage, "user"),
    readJson(localStorage, "dev_auth_session")?.user,
    readJson(localStorage, "dev_auth_session")?.session
  ];
  return sources.some(src => src?.isDeveloper === true) || document.cookie.split(';').some(part => part.trim().toLowerCase() === 'developer=true');
}
function isDeveloperRoleLike(){
const current=getCurrentUser()||{};
const role=String(current.role||current.user_role||"").toLowerCase();
return role.includes("admin")||role.includes("developer")||role.includes("dev");
}
function isActivityLogAllowed(){
return isDeveloperUser()||isPreviewBypassLoginEnabled()||isDeveloperRoleLike();
}
function isToolsDevAllowed(){
return isActivityLogAllowed();
}
window.currentUser=getCurrentUser();
const nativeFetch=window.fetch.bind(window);
const AUTHENTICATED_INVENTORY_PATHS=new Set(['/api/dashboard-summary','/api/dashboard-recent-transactions','/api/dashboard-monthly-insight','/api/movement/summary','/api/inventory-sync-status','/api/inventory-version','/api/kartu-stok','/api/barang-masuk','/api/barang-keluar','/api/rpl','/api/bulky','/api/inventory-sku-detail','/api/barcode-lookup']);
window.fetch=async(input,init={})=>{
  const url=typeof input==='string'?input:String(input?.url||'');
  if(url.startsWith('/api/')){
    const headers=new Headers(init.headers||(input instanceof Request?input.headers:{}));
    const authHeaders=await getAuthHeaders().catch(()=>({}));
    Object.entries(authHeaders).forEach(([key,value])=>{if(!headers.has(key))headers.set(key,value);});
    const apiPath=url.split('?')[0];
    if(AUTHENTICATED_INVENTORY_PATHS.has(apiPath)&&!headers.has('Authorization')){
      throw new Error(`Sesi autentikasi diperlukan untuk ${apiPath}`);
    }
    return nativeFetch(input,{...init,headers});
  }
  return nativeFetch(input,init);
};

function toUserSnapshot(profile,authUser){
const name=String(profile?.full_name||profile?.name||profile?.username||authUser?.user_metadata?.full_name||authUser?.email||"").trim();
const email=String(profile?.email||authUser?.email||"").trim();
const role=String(profile?.role||authUser?.role||"").trim();
return {name,email,role};
}
function getCurrentUserRole() {
  const readJson = (storage, key) => {
    try { return JSON.parse(storage.getItem(key) || "null"); } catch (_err) { return null; }
  };
  const sources = [
    window.currentUser,
    window.APP_STATE?.currentUser,
    window.APP_STATE?.user,
    window.APP_STATE?.authUser,
    readJson(localStorage, "currentUser"),
    readJson(localStorage, "user"),
    readJson(sessionStorage, "currentUser"),
    readJson(sessionStorage, "user")
  ];

  const found = sources.find(u => u && u.role);
  return found?.role || "";
}
window.getCurrentUserRole=getCurrentUserRole;
const READ_ONLY_TOOLTIP="Akses read-only. Hanya PIC atau Developer yang bisa mengubah data.";
function isPicRole(){
  return String(getCurrentUserRole()||"").toLowerCase().includes("pic");
}
function canCrud(){
  const isDeveloper=isDeveloperUser();
  const isPic=String(getCurrentUserRole()||"").toLowerCase().includes("pic");
  return isDeveloper||isPic;
}
function canRead(){return true;}
function canCreate(){return canCrud();}
function canUpdate(){return canCrud();}
function canDelete(){return canCrud();}
function getPermissions(){
  const crud=canCrud();
  return {canCreate:crud,canRead:true,canUpdate:crud,canDelete:crud,canSync:crud,canCrud:crud};
}
window.canRead=canRead;
window.canCreate=canCreate;
window.canUpdate=canUpdate;
window.canDelete=canDelete;
window.canCrud=canCrud;
window.getPermissions=getPermissions;
function renderReadOnlyBadge(){
  if(canCrud())return "";
  return `<span class='read-only-badge' title='${READ_ONLY_TOOLTIP}'>Read-only</span>`;
}
function applyRoleBasedUi(){
  const crud=canCrud();
  document.body?.classList.toggle("is-read-only",!crud);
  document.querySelectorAll('[data-crud-action], [data-mv-delete], [data-mv-bulk-delete], [data-mv-bulk-edit], #sheetSubmitBtn, #pdfTransferImportBtn').forEach(el=>{
    if(!crud){
      el.setAttribute('title',READ_ONLY_TOOLTIP);
      el.setAttribute('aria-disabled','true');
      if('disabled' in el)el.disabled=true;
      el.classList.add('is-read-only-disabled');
    }else{
      if(el.getAttribute('title')===READ_ONLY_TOOLTIP)el.removeAttribute('title');
      el.removeAttribute('aria-disabled');
      el.classList.remove('is-read-only-disabled');
    }
  });
}
function guardCrudAction(action='CRUD',page=location.pathname){
  if(canCrud())return true;
  toast(READ_ONLY_TOOLTIP,'error');
  logActivitySafe({action:`DENIED_${action}`,module:page,detail:READ_ONLY_TOOLTIP,status:'FAILED',metadata:{user:currentUserIdentity(),reason:'READ_ONLY_ROLE',page,timestamp:new Date().toISOString()}});
  return false;
}
window.guardCrudAction=guardCrudAction;
function setAppAuthState(state){
const appRoot=document.getElementById("appRoot");
if(!appRoot)return;
appRoot.classList.remove("is-auth-checking","is-logged-out","is-logged-in");
appRoot.classList.add(state);
}

function isTruthyFlag(value){
const normalized=String(value??'').trim().toLowerCase();
return value===true||normalized==='true'||normalized==='1'||normalized==='yes';
}

function isPreviewBypassLoginEnabled(){
const environment=String(runtimeConfig.environment||"unknown").trim().toLowerCase();
const trustedPreviewEnvironments=new Set(["preview","deploy-preview","branch-deploy","development","dev","local"]);
return trustedPreviewEnvironments.has(environment)&&isTruthyFlag(runtimeConfig.previewBypassLogin);
}
function isTrustedDevelopmentEnvironment(){
const environment=String(runtimeConfig.environment||"unknown").trim().toLowerCase();
return new Set(["preview","deploy-preview","branch-deploy","development","dev","local"]).has(environment);
}

document.addEventListener('click',e=>{
  const target=e.target?.closest?.('[data-crud-action], [data-mv-delete], [data-mv-bulk-delete], [data-mv-bulk-edit], #sheetSubmitBtn, #pdfTransferImportBtn, [data-action="delete"], [data-action="edit"]');
  if(target&&!guardCrudAction(target.dataset?.crudAction||target.dataset?.action||'CRUD')){e.preventDefault();e.stopImmediatePropagation();}
},true);
document.addEventListener('submit',e=>{
  const id=e.target?.id||'';
  if((id==='sheetInputForm'||id==='rejectInForm'||e.target?.matches?.('[data-crud-form]'))&&!guardCrudAction('SUBMIT')){e.preventDefault();e.stopImmediatePropagation();}
},true);
document.addEventListener('dblclick',e=>{
  if(e.target?.closest?.('[data-mv-cell], [contenteditable="true"], .editable-cell')&&!guardCrudAction('INLINE_EDIT')){e.preventDefault();e.stopImmediatePropagation();}
},true);

async function loadRuntimeConfig(){
const endpoints=['/api/runtime-config','/.netlify/functions/api/runtime-config','/functions/api/runtime-config'];
let loaded=null;
for(const url of endpoints){
try{
const res=await fetch(url,{cache:'no-store'});
const data=await res.json().catch(()=>null);
if(!res.ok||!data||typeof data!=='object')continue;
loaded=data;
break;
}catch(_err){}
}
if(!loaded){
runtimeConfig={previewBypassLogin:false,environment:"unknown"};
console.warn('Runtime config unavailable, fallback login normal');
return;
}
runtimeConfig={previewBypassLogin:isTruthyFlag(loaded.previewBypassLogin),environment:String(loaded.environment||"unknown").toLowerCase()};
}

const INVENTORY_PRELOAD_SHEETS=["Kartu Stock","RPL","BULKY"];
const BARANG_COLUMNS=["tanggal","from","to","sku","namaBarang","qty","status","pic","keterangan"];
function isBarangHeaderLike(row){
const values=Array.isArray(row)?row:(row&&typeof row==="object"?BARANG_COLUMNS.map(key=>row[key]):[]);
const normalized=values.map(v=>String(v??"").trim().toLowerCase().replace(/\s+/g,""));
return normalized.includes("tanggal")&&normalized.includes("sku")&&(normalized.includes("namabarang")||normalized.includes("nama"));
}
function normalizeBarangRows(rows,startRowNumber=2){
const sourceRows=Array.isArray(rows)?rows:[];
const headerOffset=sourceRows.length&&isBarangHeaderLike(sourceRows[0])?1:0;
return sourceRows
.map((row,index)=>({row,rowNumber:(Number(row?.rowNumber)||startRowNumber+index)-headerOffset}))
.filter(({row})=>row&&!(Array.isArray(row)?row.every(cell=>!String(cell??"").trim()):false))
.filter(({row})=>!isBarangHeaderLike(row))
.map(({row,rowNumber})=>{
if(row&&typeof row==="object"&&!Array.isArray(row))return {...row,rowNumber:Number(rowNumber)||Number(row.rowNumber)||startRowNumber};
const item={rowNumber};
BARANG_COLUMNS.forEach((key,index)=>{item[key]=Array.isArray(row)?row[index]??"":"";});
return item;
});
}
function normalizeBackendRows(payload){
if(Array.isArray(payload?.data))return normalizeBarangRows(payload.data,Number(payload?.startRow)||2);
if(Array.isArray(payload?.rows))return normalizeBarangRows(payload.rows,Number(payload?.startRow)||2);
if(Array.isArray(payload?.values))return normalizeBarangRows(payload.values,Number(payload?.startRow)||2);
return [];
}
function mergeLatestRows(oldRows=[],latestRows=[]){
const map=new Map();
oldRows.forEach(row=>map.set(Number(row?.rowNumber),row));
latestRows.forEach(row=>map.set(Number(row?.rowNumber),row));
return Array.from(map.values()).sort((a,b)=>Number(a?.rowNumber)-Number(b?.rowNumber));
}
function removeDeletedRows(oldRows=[],deletedRowNumbers=[]){
const deletedSet=new Set((deletedRowNumbers||[]).map(Number));
return (oldRows||[]).filter(row=>!deletedSet.has(Number(row?.rowNumber)));
}
function setModuleCache(key,rows){
const normalized=Array.isArray(rows)?rows:[];
MODULE_CACHE_MEMORY[key]=normalized;
if(isLargeCacheKey(key)){saveLargeCacheToDb(key,normalized);return;}
localStorage.setItem(key,JSON.stringify(normalized));
}
function getModuleCache(key){
if(Array.isArray(MODULE_CACHE_MEMORY[key]))return MODULE_CACHE_MEMORY[key];
if(isLargeCacheKey(key))return [];
try{return JSON.parse(localStorage.getItem(key)||"[]");}catch(_err){return [];}
}
function safeJsonParse(value,fallback=null,logError=true){
try{
if(!value||typeof value!=="string")return fallback;
return JSON.parse(value);
}catch(_err){
if(logError)console.warn("Invalid JSON cache/response:",value);
return fallback;
}
}
function setCacheSafe(key,data){
if(!Array.isArray(data)||data.length===0){console.warn("Skip empty cache",key);return;}
if(isLargeCacheKey(key)){setModuleCache(key,data);return;}
localStorage.setItem(key,JSON.stringify({timestamp:Date.now(),data}));
}
function getCacheData(key){
if(isLargeCacheKey(key))return getModuleCache(key);
const raw=localStorage.getItem(key);
const parsed=safeJsonParse(raw,null);
if(Array.isArray(parsed))return parsed;
if(parsed&&Array.isArray(parsed.data))return parsed.data;
if(raw!=null)localStorage.removeItem(key);
return [];
}
async function fetchJsonSafe(url,options={}){
const res=await fetch(url,options);
const text=await res.text();
const shouldLogInvalidJson=options?.silentInvalidJson!==true;
const data=safeJsonParse(text,null,shouldLogInvalidJson);
if(data===null){
if(shouldLogInvalidJson)console.error("API returned non JSON:",url,text);
return {res,data:{success:false,data:[],message:"Response API bukan JSON"}};
}
return {res,data};
}
// Barcode master is session-only; remove the legacy oversized payload from prior releases.
localStorage.removeItem("inventory_barcode_master");
["barangMasukCache","barangKeluarCache","inventoryCache","movementCache","appDataCache"].forEach(key=>{const raw=localStorage.getItem(key);if(raw==="API OK")localStorage.removeItem(key);});
if(HAS_INDEXED_DB)["barangMasukCache","barangKeluarCache","inventoryCache","movementCache"].forEach(key=>{if(localStorage.getItem(key)!==null)localStorage.removeItem(key);});

let preloadPromise=null;
let isInitialDataLoaded=false;
let hasPreloadStarted=false;
let isPreloadStarted=false;
let isPreloadFinished=false;
let isUserLoggedIn=false;
let isAuthStateReady=false;
let isInitialDataApplied=false;
let isRendering=false;
let hasInitializedDataFlow=false;
let isSummaryOnlyLoaded=false;
let DASHBOARD_SUMMARY=null;
let DASHBOARD_RECENT={barangMasuk:[],barangKeluar:[]};
let DASHBOARD_MONTHLY_INSIGHT=null;
let dashboardSummaryRequestId=0;
let inventorySyncStatusRequestId=0;
let inventorySyncStatusState="idle";
const LOADED_DETAIL_PAGES=new Set();
let hasRenderedInitial=false;
let lastRenderedData="";
const CACHE_FRESH_TTL_MS=3*60*1000;
const STARTUP_PREFETCH={controller:null,generation:0,promise:null,startedAt:0,warningSummary:null};
const startupMark=typeof performance!=="undefined"?performance.now():Date.now();
function startupDebug(label,started=startupMark){if(runtimeConfig.environment!=="production")console.info(`[StartupPrefetch] ${label}=${Math.round(performance.now()-started)}ms`);}
function preparePublicShell(){
// Deliberately metadata/assets only: no inventory endpoint is touched pre-auth.
document.documentElement.dataset.cacheVersion=CACHE_VERSION;
if('requestIdleCallback' in window)window.requestIdleCallback(()=>void import('./router.js'),{timeout:1500});
}
function isConstrainedConnection(){const connection=navigator.connection;return navigator.onLine===false||connection?.saveData===true||['slow-2g','2g'].includes(connection?.effectiveType);}
function waitUntilVisible(signal){if(!document.hidden)return Promise.resolve();return new Promise((resolve,reject)=>{const done=()=>{if(!document.hidden){cleanup();resolve();}},abort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));},cleanup=()=>{document.removeEventListener('visibilitychange',done);signal?.removeEventListener('abort',abort);};document.addEventListener('visibilitychange',done);signal?.addEventListener('abort',abort,{once:true});});}
function cancelStartupPrefetch(){STARTUP_PREFETCH.generation++;STARTUP_PREFETCH.controller?.abort();STARTUP_PREFETCH.controller=null;STARTUP_PREFETCH.promise=null;}
async function runPrefetchQueue(tasks,{concurrency=2,signal,generation}={}){let cursor=0;const worker=async()=>{while(cursor<tasks.length){if(signal.aborted||generation!==STARTUP_PREFETCH.generation)return;const task=tasks[cursor++];if(task.lowPriority)await waitUntilVisible(signal);if(signal.aborted)return;const started=performance.now();try{await task.run(signal);startupDebug(task.label,started);}catch(err){if(err?.name!=='AbortError')console.debug(`[StartupPrefetch] ${task.label} skipped`,err?.message||err);}}};await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},worker));}

async function prefetchTransactionFirstPage(mode,signal){
const source=transactionSource(mode),st=TABLE_STATE[mode],page=1,limit=25,query='',filters={},sort='latest';
const key=transactionPageKey({source,page,limit,query,filters,sort});
const params=new URLSearchParams({page:'1',limit:'25',sort,includeSummary:'1'});
const endpoint=mode==='in'?'/api/barang-masuk':'/api/barang-keluar';
const {res,data}=await fetchJsonSafe(`${endpoint}?${params}`,{signal});
if(!res.ok||!data?.success)throw new Error(data?.message||`HTTP ${res.status}`);
const sourceVersion=INVENTORY_VERSION_STATE.versions?.[mode==='in'?'barangMasukVersion':'barangKeluarVersion'];
const summaryKey=transactionSummaryKey({source,query,filters});
if(data.summary)TRANSACTION_PAGE_CACHE.setSummary(summaryKey,data.summary);
TRANSACTION_PAGE_CACHE.set(source,key,{rows:normalizeBackendRows(data),total:Number(data.total)||0,summary:data.summary||null,sourceVersion,fetchedAt:Date.now()});
// Page two is deliberately deferred to the low-priority queue.
return st;
}
async function prefetchTransactionSecondPage(mode,signal){const source=transactionSource(mode),limit=25,filters={},sort='latest',query='';const firstKey=transactionPageKey({source,page:1,limit,query,filters,sort}),first=TRANSACTION_PAGE_CACHE.get(source,firstKey);if(!first||Number(first.total)<=limit)return;const key=transactionPageKey({source,page:2,limit,query,filters,sort});if(TRANSACTION_PAGE_CACHE.get(source,key))return;const endpoint=mode==='in'?'/api/barang-masuk':'/api/barang-keluar',params=new URLSearchParams({page:'2',limit:String(limit),sort,includeSummary:'0'}),{res,data}=await fetchJsonSafe(`${endpoint}?${params}`,{signal});if(!res.ok||!data?.success)throw new Error(data?.message||`HTTP ${res.status}`);TRANSACTION_PAGE_CACHE.set(source,key,{rows:normalizeBackendRows(data),total:Number(data.total)||0,summary:first.summary,sourceVersion:first.sourceVersion,fetchedAt:Date.now()});}

async function prefetchLocationFirstPage(signal){const params={page:'1',limit:'25',search:'',status:'all',type:'all',sort:'skuDesc'};const [summary,page]=await Promise.all([fetchLocationJson('/api/location-summary',signal),fetchLocationJson(`/api/locations?${new URLSearchParams(params)}`,signal)]);LOCATION_STATE.summary=summary;setLimitedCache(LOCATION_STATE.pageCache,locationCacheKey(params),{...page,sourceVersion:INVENTORY_VERSION_STATE.versions?.kartuStokVersion});}

async function startInitialPrefetch(){
if(!isAuthStateReady||!user)return null;
const authHeaders=await getAuthHeaders().catch(() => ({}));
if(!authHeaders.Authorization)return null;
if(STARTUP_PREFETCH.promise)return STARTUP_PREFETCH.promise;
cancelStartupPrefetch();const controller=new AbortController(),generation=STARTUP_PREFETCH.generation;STARTUP_PREFETCH.controller=controller;STARTUP_PREFETCH.startedAt=performance.now();startupDebug('authReadyMs');
STARTUP_PREFETCH.promise=(async()=>{
await checkInventoryVersion().catch(()=>null);
const priority1=[{label:'dashboardMs',run:()=>loadDashboardSummary()},{label:'barangMasukMs',run:s=>prefetchTransactionFirstPage('in',s)},{label:'barangKeluarMs',run:s=>prefetchTransactionFirstPage('out',s)}];
await runPrefetchQueue(priority1,{concurrency:2,signal:controller.signal,generation});
if(!isConstrainedConnection())await runPrefetchQueue([{label:'locationsMs',lowPriority:true,run:s=>prefetchLocationFirstPage(s)},{label:'warningMs',lowPriority:true,run:async s=>{const {res,data}=await fetchJsonSafe('/api/inventory-warning-summary',{signal:s});if(!res.ok||!data?.success)throw new Error(data?.message||`HTTP ${res.status}`);STARTUP_PREFETCH.warningSummary={...data,sourceVersion:{...INVENTORY_VERSION_STATE.versions},fetchedAt:Date.now()};window.__inventoryWarningSummary=STARTUP_PREFETCH.warningSummary;}}],{concurrency:2,signal:controller.signal,generation});
if(!isConstrainedConnection())await runPrefetchQueue([{label:'barangMasukPage2Ms',lowPriority:true,run:s=>prefetchTransactionSecondPage('in',s)},{label:'barangKeluarPage2Ms',lowPriority:true,run:s=>prefetchTransactionSecondPage('out',s)}],{concurrency:2,signal:controller.signal,generation});
startupDebug('totalPrefetchMs',STARTUP_PREFETCH.startedAt);
})().finally(()=>{if(generation===STARTUP_PREFETCH.generation)STARTUP_PREFETCH.promise=null;});
return STARTUP_PREFETCH.promise;
}

async function startBackgroundPreload(){
return startInitialPrefetch();
}

async function hydrateAllDataOnInit({force=false,useCacheFirst=!force}={}){
if(!isAuthStateReady||!user)return null;
const authHeaders=await getAuthHeaders().catch(()=>({}));
if(!authHeaders.Authorization)return null;
const shouldUseCache=!!useCacheFirst&&!force;
const loadInventoryData=async()=>{
if(shouldUseCache&&hasValidData(window.mainDataCache))return window.mainDataCache;
return preloadInventoryData();
};
const loadBarangMasukData=async()=>{
if(shouldUseCache){const cached=normalizeBarangRows(getCacheData(MODULE_CACHE_KEYS.barangMasuk));if(cached.length)return cached;}
return loadBarangMasuk({mode:"full"});
};
const loadBarangKeluarData=async()=>{
if(shouldUseCache){const cached=normalizeBarangRows(getCacheData(MODULE_CACHE_KEYS.barangKeluar));if(cached.length)return cached;}
return loadBarangKeluar({mode:"full"});
};
const loadMovementData=async()=>{
if(shouldUseCache){const cached=getCacheData(MODULE_CACHE_KEYS.movement);if(cached.length)return cached;}
const {res,data:json}=await fetchJsonSafe('/api/movement?mode=full');
if(!res.ok||json?.success===false){console.error("INIT ERROR movement",json?.message||res.statusText);return [];}
const rows=Array.isArray(json?.data)?json.data:(Array.isArray(json?.rows)?json.rows:[]);
setCacheSafe(MODULE_CACHE_KEYS.movement,rows);return rows;
};
const results=await Promise.allSettled([
loadInventoryData(),loadBarangMasukData(),loadBarangKeluarData(),loadMovementData()
]);
results.forEach((res,i)=>{if(res.status==="rejected")console.error("INIT ERROR INDEX",i,res.reason);});
const [inventoryRes,barangMasukRes,barangKeluarRes,movementRes]=results;
const inventory=inventoryRes.status==="fulfilled"?inventoryRes.value:{};
const barangMasukRows=barangMasukRes.status==="fulfilled"?barangMasukRes.value:[];
const barangKeluarRows=barangKeluarRes.status==="fulfilled"?barangKeluarRes.value:[];
const movementRows=movementRes.status==="fulfilled"?movementRes.value:[];
applyData(inventory,{deferRender:true});
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.inventory=inventory;
window.APP_STATE.barangMasuk=Array.isArray(barangMasukRows)?barangMasukRows:[];
window.APP_STATE.barangKeluar=Array.isArray(barangKeluarRows)?barangKeluarRows:[];
window.APP_STATE.movement=Array.isArray(movementRows)?movementRows:[];
setCacheSafe(MODULE_CACHE_KEYS.barangMasuk,window.APP_STATE.barangMasuk);
setCacheSafe(MODULE_CACHE_KEYS.barangKeluar,window.APP_STATE.barangKeluar);
setCacheSafe(MODULE_CACHE_KEYS.kartuStock,Array.isArray(DATA["Kartu Stock"])?DATA["Kartu Stock"]:[]);
setCacheSafe(MODULE_CACHE_KEYS.rpl,Array.isArray(DATA["RPL"])?DATA["RPL"]:[]);
setCacheSafe(MODULE_CACHE_KEYS.bulky,Array.isArray(DATA["BULKY"])?DATA["BULKY"]:[]);
DATA["Barang Masuk"]=window.APP_STATE.barangMasuk;
DATA["Barang Keluar"]=window.APP_STATE.barangKeluar;
await saveCache(DATA);
return window.APP_STATE;
}
function preloadInventoryData(){return preloadMainData();}
function preloadMainData(){
if(window.mainDataCache){
console.log("[preloadData] gunakan cache global yang sudah ada");
return Promise.resolve(window.mainDataCache);
}
if(window.mainDataPromise){
console.log("[preloadData] gunakan promise global yang sedang berjalan");
return window.mainDataPromise;
}
console.time("preloadData");
window.mainDataPromise=(async()=>{
const freshData={};
for(const sheet of INVENTORY_PRELOAD_SHEETS){
const raw=await fetchSheet(sheet);
await new Promise(resolve=>scheduleUIWork(resolve));
freshData[sheet]=routeFetchedSourceRows(sheet,raw);
}
window.mainDataCache=freshData;
console.log("[preloadData] selesai fetch baru");
return freshData;
})().catch(err=>{
window.mainDataCache=null;
window.mainDataPromise=null;
throw err;
}).finally(()=>{
console.timeEnd("preloadData");
});
return window.mainDataPromise;
}

async function fetchUserProfile(authUserId){
if(!authUserId)return null;
const {data,error}=await supabase.from("users").select("full_name, role, username, email").eq("id",authUserId).maybeSingle();
if(error){console.error("Gagal mengambil profile user",error);return null;}
return data||null;
}

function renderSidebarProfile(profile,authUser){
const accountMeta=document.querySelector(".account-meta");
if(!accountMeta)return;
const nameEl=accountMeta.querySelector("strong");
const roleEl=accountMeta.querySelector("small");
const fallbackEmail=String(profile?.email||authUser?.email||"").trim();
const fallbackUsername=String(profile?.username||"").trim();
const displayName=String(profile?.full_name||profile?.name||"").trim()||fallbackUsername||fallbackEmail;
const displayRole=String(profile?.role||"").trim()||"User";
if(nameEl)nameEl.textContent=displayName||"-";
if(roleEl)roleEl.textContent=displayRole;
}

function renderAuthState(){
const loadingScreen=document.getElementById("authLoadingScreen");
const appRoot=document.getElementById("appRoot");
const loginView=document.getElementById("loginView");
if(authChecking){
setAppAuthState("is-auth-checking");
if(loadingScreen){loadingScreen.hidden=false;loadingScreen.style.display="flex";loadingScreen.style.pointerEvents="auto";}
if(appRoot){appRoot.hidden=true;appRoot.style.display="none";}
if(loginView){loginView.hidden=true;loginView.style.display="none";}
return;
}
if(!user){
clearCurrentUser();
setAppAuthState("is-logged-out");
if(loadingScreen){loadingScreen.hidden=true;loadingScreen.style.display="none";loadingScreen.style.pointerEvents="none";}
if(appRoot){appRoot.hidden=true;appRoot.style.display="none";}
if(loginView){loginView.hidden=false;loginView.style.display="grid";}
return;
}
if(loadingScreen){
loadingScreen.hidden=true;
loadingScreen.style.display="none";
loadingScreen.style.pointerEvents="none";
}
setAppAuthState("is-logged-in");
if(loginView){loginView.hidden=true;loginView.style.display="none";}
if(appRoot){appRoot.hidden=false;appRoot.style.display="block";}
setCurrentUser({id:user?.id||null,isDeveloper:user?.id==="developer",name:"",email:String(user?.email||""),role:""});
}
async function bootApplication(){
const requestGeneration=++authRequestGeneration;
authChecking=true;
isAuthStateReady=false;
applyTheme();
renderAuthState();
preparePublicShell();
await loadRuntimeConfig();
let session=null;
try{
if(isPreviewBypassLoginEnabled()){
user={id:'preview-bypass',email:'preview@local'};
devProfile={full_name:'Developer',role:'Mode Development',username:'developer',email:'preview@local'};
}else{
session=await restoreSession({allowDeveloperSession:isTrustedDevelopmentEnvironment()});
if(requestGeneration!==authRequestGeneration)return;
if(session){
if(session?.isDeveloper){
user={id:"developer"};
devProfile=session.user||null;
}else{
const {data:userData,error:userErr}=await getAuthenticatedUser();
if(requestGeneration!==authRequestGeneration)return;
if(userErr)throw userErr;
user=userData?.user||null;
}
}else{
user=null;
}
}
}catch(err){
console.error("Auth session check failed",err);
user=null;
}finally{
if(requestGeneration!==authRequestGeneration)return;
authChecking=false;
isAuthStateReady=true;
renderAuthState();
}
isUserLoggedIn=!!user;
if(!user){bindLoginView();if(window.lucide)lucide.createIcons();return;}
// A restored session is the security boundary; do not wait for route navigation.
void startInitialPrefetch();
const profile=devProfile||await fetchUserProfile(user.id);
console.log("Profile public.users:",profile);
if(!profile){
console.warn("Profile tidak ditemukan / tidak bisa diakses. Pastikan RLS public.users mengizinkan select untuk user id sendiri.");
}
renderSidebarProfile(profile,user);
const loginUserSnapshot=toUserSnapshot(profile,user);
setCurrentUser({...getCurrentUser(),...loginUserSnapshot,isDeveloper:Boolean(session?.isDeveloper)});
const autoLoginKey=`activity-auto-login:${user.id}:${new Date().toISOString().slice(0,10)}`;
if(!sessionStorage.getItem(autoLoginKey)){sessionStorage.setItem(autoLoginKey,'1');logLogin({...currentUserIdentity(),user:loginUserSnapshot.full_name||loginUserSnapshot.username||user.email||'User',auto:true,isDeveloper:Boolean(session?.isDeveloper),module:'Auth',page:location.pathname,details:{method:'SESSION_RESTORE'}});}
if(!appInitialized){
bindNav();bindEvents();bindLogoutButtons();setupSidebar();syncDeveloperMenuVisibility();renderFilters();applyRoleBasedUi();setMainContentLoading(true);document.getElementById("sheetInfo").textContent=SHEETS.join(", ");document.getElementById("spreadsheetInfo").textContent=SPREADSHEET_ID;renderRecentHistory();renderQuickResultCard(null,"","hint");renderState("results",`Ketik minimal ${SEARCH_STATE.minChars} huruf untuk mencari.`);routeFromPath(location.pathname);window.addEventListener("popstate",()=>routeFromPath(location.pathname));appInitialized=true;
}else{
syncDeveloperMenuVisibility();
}
await initAppData();
if(window.lucide)lucide.createIcons();
}

// Static module dependencies (notably runtime config) can finish after the DOM
// event has already fired. In that case an event listener alone never runs.
if(document.readyState==="loading"){
window.addEventListener("DOMContentLoaded",bootApplication,{once:true});
}else{
void bootApplication();
}
window.addEventListener("auth:logout",async()=>{
const logoutIdentity=currentUserIdentity();
++authRequestGeneration;
cancelStartupPrefetch();
INVENTORY_VERSION_STATE.controller?.abort();
INVENTORY_VERSION_STATE.versions=null;
TRANSACTION_PAGE_CACHE.clearSource('barang_masuk');
TRANSACTION_PAGE_CACHE.clearSource('barang_keluar');
TRANSACTION_PREFETCH_IN_FLIGHT.clear();
TRANSACTION_PREFETCH_FAILED.clear();
LOCATION_STATE.summary=null;LOCATION_STATE.rows=[];LOCATION_STATE.pageCache.clear();LOCATION_STATE.detailCache.clear();
STARTUP_PREFETCH.warningSummary=null;window.__inventoryWarningSummary=null;
Object.keys(MODULE_CACHE_MEMORY).forEach(key=>delete MODULE_CACHE_MEMORY[key]);
Object.keys(DATA).forEach(key=>delete DATA[key]);
if(window.APP_STATE){window.APP_STATE.inventory={};window.APP_STATE.barangMasuk=[];window.APP_STATE.barangKeluar=[];window.APP_STATE.movement=[];}
for(const key of [...LARGE_CACHE_KEYS,ANOMALY_CACHE_KEY])localStorage.removeItem(key);
void clearCache();
++dashboardSummaryRequestId;
++inventorySyncStatusRequestId;
user=null;
devProfile=null;
authChecking=false;
isUserLoggedIn=false;
isAuthStateReady=false;
hasInitializedDataFlow=false;
preloadPromise=null;
hasPreloadStarted=false;
isPreloadStarted=false;
isPreloadFinished=false;
window.mainDataPromise=null;
DASHBOARD_SUMMARY=null;
isSummaryOnlyLoaded=false;
window.__inventorySyncStatus=null;
inventorySyncStatusState="idle";
clearCurrentUser();
stopDevAutoRefresh({log:false});
showLoginView();
await logLogout({...logoutIdentity,module:"Auth",page:location.pathname,details:{method:"MANUAL"}});
});

function bindLoginView(){
const form=document.getElementById("loginForm"),emailEl=document.getElementById("email"),passwordEl=document.getElementById("password"),loginBtn=document.getElementById("loginBtn"),errorMsg=document.getElementById("formError"),errorText=errorMsg?.querySelector("span"),togglePasswordBtn=document.getElementById("togglePassword"),signupForm=document.getElementById("signupForm"),signupError=document.getElementById("signupError"),signupErrorText=signupError?.querySelector("span"),signupLink=document.getElementById("signupLink"),loginLink=document.getElementById("loginLink"),googleLoginBtn=document.getElementById("googleLoginBtn"),divider=document.querySelector(".divider"),rememberRow=document.querySelector(".remember-row"),loginLine=document.getElementById("loginLine"),signupBtn=document.getElementById("signupBtn"),signupAccessModal=document.getElementById("signupAccessModal"),signupAccessForm=document.getElementById("signupAccessForm"),signupAccessPassword=document.getElementById("signupAccessPassword"),signupAccessError=document.getElementById("signupAccessError"),signupAccessErrorText=signupAccessError?.querySelector("span");
if(!form||form.dataset.bound==="1")return;
let signupAccessGranted=false;
const showError=(message)=>{if(!errorMsg||!errorText)return;errorText.textContent=message||"";errorMsg.hidden=!message;errorMsg.style.display=message?"flex":"none";if(window.lucide)lucide.createIcons();};
const showSignupError=(message)=>{if(!signupError||!signupErrorText)return;signupErrorText.textContent=message||"";signupError.hidden=!message;signupError.style.display=message?"flex":"none";if(window.lucide)lucide.createIcons();};
const setLoading=(isLoading)=>{const labelEl=loginBtn.querySelector("span");const spinnerEl=loginBtn.querySelector(".btn-spinner");loginBtn.disabled=isLoading;loginBtn.classList.toggle("is-loading",isLoading);if(labelEl)labelEl.textContent=isLoading?"Memproses":"Login";if(spinnerEl)spinnerEl.hidden=!isLoading;loginBtn.style.cursor=isLoading?"not-allowed":"";};
const setSignupLoading=(isLoading)=>{const labelEl=signupBtn?.querySelector("span");const spinnerEl=signupBtn?.querySelector(".btn-spinner");if(!signupBtn)return;signupBtn.disabled=isLoading;signupBtn.classList.toggle("is-loading",isLoading);if(labelEl)labelEl.textContent=isLoading?"Memproses":"Sign Up";if(spinnerEl)spinnerEl.hidden=!isLoading;};
const showAuthMode=(mode)=>{const isSignup=mode==="signup";if(signupForm)signupForm.hidden=!isSignup;form.hidden=isSignup;if(googleLoginBtn)googleLoginBtn.hidden=isSignup;if(divider)divider.hidden=isSignup;if(rememberRow)rememberRow.hidden=isSignup;if(loginLine)loginLine.hidden=!isSignup;if(signupLink?.parentElement)signupLink.parentElement.hidden=isSignup;showError("");showSignupError("");if(window.lucide)lucide.createIcons();};
const showSignupAccessError=(message)=>{if(!signupAccessError||!signupAccessErrorText)return;signupAccessErrorText.textContent=message||"";signupAccessError.hidden=!message;};
const closeSignupAccessModal=()=>{if(!signupAccessModal)return;signupAccessModal.hidden=true;document.body.classList.remove("signup-access-open");signupAccessForm?.reset();showSignupAccessError("");signupLink?.focus();};
const openSignupAccessModal=()=>{if(!signupAccessModal)return;signupAccessModal.hidden=false;document.body.classList.add("signup-access-open");showSignupAccessError("");if(window.lucide)lucide.createIcons();requestAnimationFrame(()=>signupAccessPassword?.focus());};
const emailRegex=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mapSignupError=(err)=>{const msg=String(err?.message||"").toLowerCase();if(msg.includes("email")&&(msg.includes("already")||msg.includes("registered")||msg.includes("exists")||msg.includes("duplicate")))return "Email sudah dipakai.";if(msg.includes("username")&&(msg.includes("exists")||msg.includes("duplicate")||msg.includes("already")))return "Username sudah dipakai.";if(err?.code==="23505"&&String(err?.details||"").toLowerCase().includes("username"))return "Username sudah dipakai.";if(err?.code==="23505")return "Email sudah dipakai.";return err?.message||"Sign up gagal. Coba lagi.";};
const ensureSignupIdentityAvailable=async(email,username)=>{const [{data:emailUsers,error:emailError},{data:usernameUsers,error:usernameError}]=await Promise.all([supabase.from("users").select("id").eq("email",email).limit(1),supabase.from("users").select("id").eq("username",username).limit(1)]);if(emailError)throw emailError;if(usernameError)throw usernameError;if(emailUsers?.length)throw new Error("Email already registered");if(usernameUsers?.length)throw new Error("Username already exists");};
togglePasswordBtn?.addEventListener("click",(e)=>{e.preventDefault();passwordEl.type=passwordEl.type==="password"?"text":"password";const isVisible=passwordEl.type==="text";togglePasswordBtn.setAttribute("aria-pressed",String(isVisible));togglePasswordBtn.innerHTML=`<i data-lucide="${isVisible?"eye":"eye-off"}"></i>`;if(window.lucide)lucide.createIcons();});
signupLink?.addEventListener("click",(e)=>{e.preventDefault();openSignupAccessModal();});
signupAccessForm?.addEventListener("submit",(e)=>{e.preventDefault();if(signupAccessPassword?.value!==SIGNUP_ACCESS_PASSWORD){showSignupAccessError("Password akses salah. Silakan coba lagi.");signupAccessPassword?.select();return;}signupAccessGranted=true;closeSignupAccessModal();showAuthMode("signup");document.getElementById("signupFullName")?.focus();});
signupAccessModal?.querySelectorAll("[data-signup-access-close]").forEach(el=>el.addEventListener("click",closeSignupAccessModal));
document.addEventListener("keydown",(e)=>{if(e.key==="Escape"&&!signupAccessModal?.hidden)closeSignupAccessModal();});
loginLink?.addEventListener("click",(e)=>{e.preventDefault();signupAccessGranted=false;showAuthMode("login");});
form.addEventListener("submit",async (e)=>{e.preventDefault();showError("");setLoading(true);const requestGeneration=++authRequestGeneration;try{const loginInput=emailEl.value.trim();const {data,error}=await loginWithEmailPassword(loginInput,passwordEl.value);if(error)throw error;if(requestGeneration!==authRequestGeneration)return;if(data?.mode==="dev"){user={id:"developer"};devProfile=data.user;logLogin({user:data.user?.full_name||"Akun Developer",role:"Developer",isDeveloper:true,module:"Auth",page:"/login",details:{method:"DEVELOPER_LOGIN"}});}else{const {data:sessionData,error:sessionError}=await supabase.auth.getSession();if(sessionError)throw sessionError;if(!sessionData?.session?.access_token)throw new Error("Sesi login tidak memiliki access token.");const {data:userData,error:userErr}=await supabase.auth.getUser();if(userErr)throw userErr;user=userData?.user||null;devProfile=null;logLogin({user:userData?.user?.email||"User",module:"Auth",page:"/login",details:{method:"PASSWORD"}});}authChecking=false;isAuthStateReady=true;isUserLoggedIn=!!user;hasInitializedDataFlow=false;DASHBOARD_SUMMARY=null;isSummaryOnlyLoaded=false;window.__inventorySyncStatus=null;inventorySyncStatusState="idle";renderAuthState();if(user){void startInitialPrefetch();const profile=devProfile||await fetchUserProfile(user.id);renderSidebarProfile(profile,user);const loginUserSnapshot=toUserSnapshot(profile,user);setCurrentUser({...getCurrentUser(),...loginUserSnapshot,isDeveloper:data?.mode==="dev"||profile?.isDeveloper===true});if(!appInitialized){bindNav();bindEvents();bindLogoutButtons();setupSidebar();syncDeveloperMenuVisibility();renderFilters();applyRoleBasedUi();setMainContentLoading(true);document.getElementById("sheetInfo").textContent=SHEETS.join(", ");document.getElementById("spreadsheetInfo").textContent=SPREADSHEET_ID;renderRecentHistory();renderQuickResultCard(null,"","hint");renderState("results",`Ketik minimal ${SEARCH_STATE.minChars} huruf untuk mencari.`);routeFromPath(location.pathname);window.addEventListener("popstate",()=>routeFromPath(location.pathname));appInitialized=true;}else{syncDeveloperMenuVisibility();setMainContentLoading(true);}void initAppData();applyRoleBasedUi();}}catch(err){logLogin({module:"Auth",page:"/login",failed:true,username:emailEl.value.trim(),result:"FAILED",details:{username:emailEl.value.trim(),reason:"INVALID_CREDENTIALS"}});showError(err?.message||"Login gagal. Coba lagi.");}finally{setLoading(false);}});
signupForm?.addEventListener("submit",async(e)=>{e.preventDefault();showSignupError("");if(!signupAccessGranted){showAuthMode("login");openSignupAccessModal();return;}const fullNameInput=document.getElementById("signupFullName"),usernameInput=document.getElementById("signupUsername"),emailInput=document.getElementById("signupEmail"),passwordInput=document.getElementById("signupPassword"),confirmPasswordInput=document.getElementById("signupConfirmPassword");const fullName=fullNameInput?.value?.trim()||"";const username=usernameInput?.value?.trim()||"";const email=emailInput?.value?.trim().toLowerCase()||"";const password=passwordInput?.value||"";const confirmPassword=confirmPasswordInput?.value||"";if(!fullName||!username||!email||!password||!confirmPassword)return showSignupError("Semua field wajib diisi.");if(username.includes(" "))return showSignupError("Username tidak boleh mengandung spasi.");if(!emailRegex.test(email))return showSignupError("Format email tidak valid.");if(password!==confirmPassword)return showSignupError("Confirm password harus sama.");setSignupLoading(true);try{await ensureSignupIdentityAvailable(email,username);const {data:authData,error:signupErr}=await supabase.auth.signUp({email,password});console.log("auth signup result",authData,signupErr);if(signupErr)throw signupErr;const authUserId=authData?.user?.id;if(!authUserId)throw new Error("Gagal mendapatkan ID user.");console.log("user id",authUserId);const profilePayload={id:authUserId,email,username,full_name:fullName,role:"Warga KST"};console.log("payload public.users",profilePayload);const {error:profileErr}=await supabase.from("users").upsert(profilePayload,{onConflict:"id"});if(profileErr){console.log("error save profile",profileErr);const profileMsg=String(profileErr?.message||"").toLowerCase();if(profileErr?.code==="42501"||profileMsg.includes("row-level security")||profileMsg.includes("rls"))return showSignupError("Akun berhasil dibuat, tapi profile gagal disimpan.");throw profileErr;}await logActivity({user_id:authUserId,user_name:fullName||username||email,role:"Warga KST",action:"REGISTER_SUCCESS",module:"Auth",detail:`User baru terdaftar: ${username||email}`,reference:authUserId,status:"SUCCESS",metadata:{email,username}});signupForm.reset();signupAccessGranted=false;showAuthMode("login");showError("Registrasi berhasil. Silakan login.");}catch(err){showSignupError(mapSignupError(err));}finally{setSignupLoading(false);}});
showAuthMode("login");
form.dataset.bound="1";
}
function bindNav(){
document.querySelectorAll(".side-link[data-route]").forEach(btn=>btn.addEventListener("click",()=>{if(btn.dataset.route==="/activity-log"&&!isDeveloperUser()){navigateTo("/dashboard");closeSidebarMobile();return;}if(btn.dataset.route==="/tools-dev"&&!isToolsDevAllowed()){navigateTo("/dashboard");closeSidebarMobile();return;}navigateTo(btn.dataset.route);closeSidebarMobile();}));
document.querySelectorAll("[data-sidebar-parent]").forEach(btn=>btn.addEventListener("click",()=>toggleSidebarMenu(btn.dataset.sidebarParent)));
}
async function refreshMovementTableData(mode,{deletedRowNumbers=[]}={}){
const sheetName=mode==='in'?'Barang Masuk':'Barang Keluar';
await refreshSheetByLatestMerge(sheetName,{deletedRowNumbers});
TABLE_STATE[mode].selected.clear();
renderDataTablePage(mode,sheetName,false);
}

function bindEvents(){searchInput?.addEventListener("input",e=>scheduleSearchFilter(e.target?.value||""));statsFilter?.addEventListener("change",updateStats);darkBtnHeader?.addEventListener("click",toggleDark);refreshToggleHeader?.addEventListener("click",triggerManualRefresh);bindDevAutoRefreshControls();const din=debounce(()=>loadTransactionTablePage("in",{page:1,search:inSearch?.value}),400),dout=debounce(()=>loadTransactionTablePage("out",{page:1,search:outSearch?.value}),400);inSearch?.addEventListener("input",din);outSearch?.addEventListener("input",dout);window.addEventListener("resize",()=>{document.querySelectorAll("[data-col-filter-menu]:not([hidden])").forEach(menu=>positionColumnFilterMenu(menu));document.querySelectorAll(".mv-columns.open").forEach(panel=>positionColumnMenu(panel.id.replace("mv-cols-","")));});document.addEventListener("change",e=>{const t=e.target;if(t?.matches("[data-mv-filter]")){const m=t.dataset.mvMode,st=TABLE_STATE[m];if(t.id===`mv-sort-${m}`){st.sort=t.value||"latest";st.page=1;loadTransactionTablePage(m,{page:1});}else{st.pageSize=Number(t.value)||25;st.page=1;loadTransactionTablePage(m,{page:1,limit:st.pageSize});}}if(t?.closest("[data-col-filter-menu]")&&t?.matches('input[type="checkbox"]')){const menu=t.closest("[data-col-filter-menu]");const mode=menu.dataset.mode,col=menu.dataset.col;const selected=[...menu.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);const st=mode==='balikan'?ensureBalikanFilterState():(TABLE_STATE[mode]||{});ensureColumnFilterState(mode);if(!st.columnFilters)st.columnFilters={};st.columnFilters[col]=selected;st.openFilterCol=col;if(mode==='balikan')scheduleBalikanRender(false,250);else rerenderTableWithScrollRestore(mode,true);}});document.addEventListener("input",e=>{const t=e.target;if(!t?.matches("[data-col-filter-search]"))return;const q=clean(t.value);const menu=t.closest("[data-col-filter-menu]");menu?.querySelectorAll("[data-opt-item]").forEach(item=>{item.style.display=!q||clean(item.textContent).includes(q)?"":"none";});});document.addEventListener("click",e=>{const syncRetry=e.target.closest("[data-retry-sync-status]");if(syncRetry){loadInventorySyncStatus().catch(err=>console.error("Inventory sync status retry failed",err));return;}const dashboardRetry=e.target.closest("[data-retry-dashboard-summary]");if(dashboardRetry){loadDashboardSummary().catch(err=>console.error("Dashboard summary retry failed",err));return;}const btn=e.target.closest("[data-search-page]");if(!btn)return;changeSearchPage(Number(btn.dataset.searchPage)||0);});anomalySeverity?.addEventListener("change",()=>applyAnomalyFilters(true));
searchInput?.addEventListener("focus",()=>{if(!searchModalOpen)openSearchModal();});
document.getElementById("btnScanSku")?.addEventListener("click",()=>{logActivitySafe({action:"SCAN_BARCODE_SKU",module:"Search",detail:"User membuka scanner barcode SKU",status:"SUCCESS"});openBarcodeScanner("searchInput",handleSearchScanResult);});
btnScanBalikan?.addEventListener("click",()=>openBalikanScanner());
balikanSheetSelect?.addEventListener("change",async(e)=>{window.currentTripSheet=e.target.value||"";BALIKAN_STATE.highlightRowNumber=null;BALIKAN_STATE.highlightSheetName="";BALIKAN_STATE.selectedSkuRowNumber=null;BALIKAN_STATE.selectedSkuSheetName="";BALIKAN_STATE.selectedSkuValue="";await loadBalikanRows();});
balikanSearchInput?.addEventListener("input",e=>{window.balikanSearchKeyword=e.target.value||"";BALIKAN_STATE.exactScanSku="";BALIKAN_STATE.selectedSkuRowNumber=null;BALIKAN_STATE.selectedSkuSheetName="";BALIKAN_STATE.selectedSkuValue="";syncBalikanSkuStepper();clearTimeout(BALIKAN_STATE.searchDebounceTimer);BALIKAN_STATE.searchDebounceTimer=setTimeout(()=>saveBalikanSearchHistory(window.balikanSearchKeyword),320);scheduleBalikanRender(false,300);});
document.querySelector('.balikan-sku-stepper')?.addEventListener('click',e=>{const button=e.target.closest('[data-balikan-sku-step]');if(button&&!button.disabled)stepBalikanSku(Number(button.dataset.balikanSkuStep));});
syncBalikanSkuStepper();
renderBalikanSearchHistory();
balikanSearchHistory?.addEventListener("click",e=>{const removeBtn=e.target.closest("[data-balikan-history-remove]");if(removeBtn){e.stopPropagation();removeBalikanSearchHistory(decodeURIComponent(removeBtn.dataset.balikanHistoryRemove||""));return;}const chip=e.target.closest("[data-balikan-history]");if(chip){applyBalikanSearchHistory(decodeURIComponent(chip.dataset.balikanHistory||""));return;}if(e.target.closest("[data-balikan-history-clear]"))clearBalikanSearchHistory();});
balikanSortSelect?.addEventListener("change",e=>{BALIKAN_STATE.sortBy=e.target.value||"default";scheduleBalikanRender(false,250);});
btnResetBalikanFilter?.addEventListener("click",resetBalikanSearch);
btnExportBalikanCsv?.addEventListener("click",()=>exportBalikanFilteredCsv());
balikanSummary?.addEventListener("click",e=>{const btn=e.target.closest('[data-balikan-location-select]');if(btn)handleBalikanLocationSelect(btn);});
balikanAutoCheckToggle?.addEventListener("change",e=>toggleBalikanAutoCheck(e.target?.checked===true));
initBalikanAutoCheckPreference();syncBalikanAutoCheckToggle();
document.getElementById("scannerCloseBtn")?.addEventListener("click",closeScannerModal);
document.getElementById("scannerCloseBtnText")?.addEventListener("click",closeScannerModal);
document.querySelector("[data-scanner-close]")?.addEventListener("click",closeScannerModal);
window.addEventListener("keydown",handleSearchShortcuts);
const clearHistoryBtn=document.getElementById("clearSearchHistory");
clearHistoryBtn?.addEventListener("click",clearSearchHistory);
document.getElementById("recentSearch")?.addEventListener("click",e=>{const btn=e.target.closest("[data-history]");if(!btn)return;searchInput.value=decodeURIComponent(btn.dataset.history||"");SEARCH_STATE.inputValue=searchInput.value;SEARCH_STATE.filterValue=searchInput.value;runSearch();});
anomalyType?.addEventListener("change",()=>applyAnomalyFilters(true));anomalySearch?.addEventListener("input",e=>scheduleAnomalySearch(e.target?.value||""));
bindSheetInputForm();
bindArchiveEvents();
bindAssetStoreEvents();
document.addEventListener("click",e=>{const btn=e.target.closest("[data-mv-action]");if(btn){const mode=btn.dataset.mvMode;const action=btn.dataset.mvAction;if(action==="reset")return resetMovementFilter(mode);if(action==="retry")return loadTransactionTablePage(mode,{page:TABLE_STATE[mode].page});if(action==="export")return exportFilteredCsv(mode);if(action==="prev"||action==="next")return paginateRows(mode,action);if(action==="toggle-filter"){document.getElementById(`mv-filters-${mode}`)?.classList.toggle("open");}if(action==="columns"){toggleColumnMenu(mode);return;}return;}
if(e.target.closest(".document-link-btn"))return;
const mvCell=e.target.closest('[data-mv-cell]');if(mvCell){const mode=mvCell.dataset.mode,row=Number(mvCell.dataset.row),field=mvCell.dataset.field;const item=TABLE_STATE[mode].rows.find(r=>r.rowNumber===row);if(item)startInlineEdit(mvCell,item,field,item[field],{showSaveButton:false,onSave:async({value,oldValue,td})=>{td.classList.add('is-saving');td.innerHTML="<span class='btn-spinner-inline' aria-hidden='true'></span>";let out={};let res;try{res=await fetch(mode==='in'?'/api/barang-masuk/bulk-update':'/api/barang-keluar/bulk-update',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rowNumbers:[row],updates:{[field]:value}})});out=await res.json();if(!res.ok||!out?.success)throw new Error(out?.message||'Gagal update');item[field]=value;const moduleName=mode==='in'?'barang-masuk':'barang-keluar';const sheetName=mode==='in'?'Barang Masuk':'Barang Keluar';const localRows=updateLocalRow(moduleName,row,field,value);const targetRows=updateCacheRow(moduleName,row,field,value);DATA[sheetName]=localRows;saveCache(DATA);td.innerHTML='';td.textContent=value||'-';td.dataset.value=value||'';td.dataset.oldValue=value||'';console.log('INLINE SUCCESS UPDATE UI',{rowNumber:row,field,newValue:value,tdText:td.textContent});toast('Data berhasil diupdate','success');logActivitySafe({action:mode==='in'?'EDIT_BARANG_MASUK':'EDIT_BARANG_KELUAR',module:mode==='in'?'Barang Masuk':'Barang Keluar',detail:`Edit ${field} row ${row}`,status:'SUCCESS'});}finally{td.classList.remove('is-saving');}}});return;}
const mvDelete=e.target.closest('[data-mv-delete]');if(mvDelete){const mode=mvDelete.dataset.mvDelete,row=Number(mvDelete.dataset.row);showConfirmModal({title:'Hapus Data',message:'Yakin ingin hapus data ini?',confirmText:'Hapus',cancelText:'Batal',type:'danger',onConfirm:async()=>{const st=TABLE_STATE[mode];st.deletingRows.add(row);renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);try{const res=await fetch(mode==='in'?`/api/barang-masuk/${row}`:`/api/barang-keluar/${row}`,{method:'DELETE'});const out=await res.json();if(!res.ok||!out?.success)throw new Error(out?.message||'Gagal hapus');await refreshMovementTableData(mode,{deletedRowNumbers:[row]});toast('Data berhasil dihapus','success');logActivitySafe({action:mode==='in'?'DELETE_BARANG_MASUK':'DELETE_BARANG_KELUAR',module:mode,status:'SUCCESS'});}catch(err){toast('Gagal menghapus data','error');}finally{st.deletingRows.delete(row);renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);}}});return;}
const bulkDelete=e.target.closest('[data-mv-bulk-delete]');if(bulkDelete){const mode=bulkDelete.dataset.mvBulkDelete,selectedSet=getSelectedSet(mode),rows=[...selectedSet];if(!rows.length)return;showConfirmModal({title:'Bulk Delete',message:`Hapus ${rows.length} item?`,confirmText:'Hapus',cancelText:'Batal',type:'danger',onConfirm:async()=>{const st=TABLE_STATE[mode];st.bulkDeleting=true;renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);try{const res=await fetch(mode==='in'?'/api/barang-masuk/bulk-delete':'/api/barang-keluar/bulk-delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rowNumbers:rows})});const out=await res.json();if(!res.ok||!out?.success)throw new Error(out?.message||'Gagal bulk delete');await refreshMovementTableData(mode,{deletedRowNumbers:rows});toast('Data berhasil dihapus','success');}catch(err){toast('Gagal menghapus data','error');}finally{st.bulkDeleting=false;renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);}}});return;}
const bulkEdit=e.target.closest('[data-mv-bulk-edit]');if(bulkEdit){const mode=bulkEdit.dataset.mvBulkEdit,selectedSet=getSelectedSet(mode),rows=[...selectedSet];if(!rows.length)return;const formHtml=`<div class='mv-bulk-edit-modal'><div class='subtitle'>${rows.length} item dipilih</div><div class='mv-bulk-edit-grid'><label>Tanggal<input id='mvBulkTanggal' class='search-lg' placeholder='Tanggal'></label><label>From<input id='mvBulkFrom' class='search-lg' placeholder='From'></label><label>To<input id='mvBulkTo' class='search-lg' placeholder='To'></label><label>SKU<input id='mvBulkSku' class='search-lg' placeholder='SKU'></label><label>Nama Barang<input id='mvBulkNamaBarang' class='search-lg' placeholder='Nama Barang'></label><label>Qty<input id='mvBulkQty' class='search-lg' placeholder='Qty' type='number'></label><label>Status<input id='mvBulkStatus' class='search-lg' placeholder='Status'></label><label>PIC<input id='mvBulkPic' class='search-lg' placeholder='PIC'></label><label>Keterangan<input id='mvBulkKeterangan' class='search-lg' placeholder='Keterangan'></label></div></div>`;showConfirmModal({title:'Bulk Edit',message:formHtml,allowHtmlMessage:true,confirmText:'Simpan Perubahan',cancelText:'Batal',onConfirm:()=>{const updates={};const map=[['tanggal','mvBulkTanggal'],['from','mvBulkFrom'],['to','mvBulkTo'],['sku','mvBulkSku'],['namaBarang','mvBulkNamaBarang'],['qty','mvBulkQty'],['status','mvBulkStatus'],['pic','mvBulkPic'],['keterangan','mvBulkKeterangan']];for(const [key,id] of map){const raw=(document.getElementById(id)?.value??'');const value=String(raw).trim();if(value!=="")updates[key]=key==='qty'?Number(value):value;}if(!Object.keys(updates).length){toast('Isi minimal 1 field untuk update','error');return;}fetch(mode==='in'?'/api/barang-masuk/bulk-update':'/api/barang-keluar/bulk-update',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rowNumbers:rows,updates})}).then(async r=>({ok:r.ok,out:await r.json()})).then(({ok,out})=>{if(!ok||!out?.success)throw new Error(out?.message||'Gagal bulk edit');TABLE_STATE[mode].rows.forEach(r=>{if(selectedSet.has(r.rowNumber))Object.assign(r,updates);});selectedSet.clear();renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);toast('Bulk edit berhasil','success');}).catch(err=>toast(err?.message||'Gagal bulk edit','error'));}});return;}
const accountToggle=e.target.closest("[data-account-menu-toggle]"),accountMenu=document.querySelector("[data-account-menu]");
if(accountToggle){if(accountMenu)accountMenu.hidden=!accountMenu.hidden;return;}
if(accountMenu&&!e.target.closest(".account-card"))accountMenu.hidden=true;
const closeBtn=e.target.closest("[data-mv-columns-close]");if(closeBtn){closeColumnMenus();return;}
if(!e.target.closest(".mv-column-dropdown-wrap"))closeColumnMenus();
const toggle=e.target.closest("[data-col-filter-toggle]");if(toggle){const mode=toggle.dataset.mode,col=toggle.dataset.col;document.querySelectorAll(`[data-col-filter-menu][data-mode="${mode}"]`).forEach(menu=>menu.hidden=true);const menu=document.querySelector(`[data-col-filter-menu][data-mode="${mode}"][data-col="${col}"]`);if(menu){menu.hidden=!menu.hidden;const st=TABLE_STATE[mode];if(st)st.openFilterCol=menu.hidden?"":col;if(mode==='balikan'){const balikanState=ensureBalikanFilterState();balikanState.openFilterCol=menu.hidden?'':col;}if(!menu.hidden)positionColumnFilterMenu(menu);}return;}
if(e.target.closest("[data-col-filter-menu]")){const menu=e.target.closest("[data-col-filter-menu]");const mode=menu.dataset.mode,col=menu.dataset.col;const st=mode==='balikan'?ensureBalikanFilterState():(TABLE_STATE[mode]||{});ensureColumnFilterState(mode);if(e.target.matches("[data-col-filter-clear]")){st.columnFilters[col]=[];st.openFilterCol=col;if(mode==='balikan')scheduleBalikanRender(false,0);else rerenderTableWithScrollRestore(mode,true);}if(e.target.matches("[data-col-filter-all]")){const rowsSource=mode==='balikan'?((BALIKAN_STATE.filterState?.rows)||[]):(st.rows||[]);const applier=mode==='balikan'?applyBalikanTableFilters:applyTableFilters;st.columnFilters[col]=getUniqueOptions(applier(rowsSource,mode,col),col);st.openFilterCol=col;if(mode==='balikan')scheduleBalikanRender(false,0);else rerenderTableWithScrollRestore(mode,true);}return;}
document.querySelectorAll("[data-col-filter-menu]").forEach(menu=>menu.hidden=true);Object.values(TABLE_STATE).forEach(st=>{if(st)st.openFilterCol="";});ensureBalikanFilterState().openFilterCol="";});}
document.addEventListener('change',e=>{const sel=e.target.closest('[data-mv-select]');if(sel){const mode=sel.dataset.mvSelect,row=Number(sel.dataset.row),selectedSet=getSelectedSet(mode);if(sel.checked)selectedSet.add(row);else selectedSet.delete(row);renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);return;}const all=e.target.closest('[data-mv-select-all]');if(all){const mode=all.dataset.mvSelectAll;const st=TABLE_STATE[mode],selectedSet=getSelectedSet(mode);const pageRows=st.filtered;pageRows.forEach(r=>all.checked?selectedSet.add(r.rowNumber):selectedSet.delete(r.rowNumber));renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);}});
window.addEventListener("keydown",e=>{if(e.key==="Escape")closeColumnMenus();});
function getBarangRejectNavPage(){return `barang-reject-${BARANG_REJECT_STATE.activeTab==='dashboard'?'dashboard':BARANG_REJECT_STATE.activeTab==='masuk'?'masuk':BARANG_REJECT_STATE.activeTab==='keluar'?'keluar':'input'}`;}
function showPage(page){if(page!=="search")closeScannerModal();document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));document.getElementById(`page-${page}`)?.classList.remove("hidden");document.querySelectorAll(".side-link[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page||(page==="barang-reject"&&b.dataset.page===getBarangRejectNavPage())));syncActiveSidebarParent(page);invalidateInactiveTransactionRequests(page);if(page==="barang-reject"){renderBarangRejectPage();return;}if(page==="detail"){setMainContentLoading(false);return;}if(page==="locations"){setMainContentLoading(false);renderLocationsPage();return;}if(page==="barang-masuk"||page==="barang-keluar"){const mode=page==="barang-masuk"?"in":"out";setMainContentLoading(false);loadDetailPageData(page).then(()=>{LOADED_DETAIL_PAGES.add(page);window.__isDataReady=true;}).catch(err=>{if(err?.name!=="AbortError")console.error("Transaction page load failed",err);});return;}if(!["dashboard","search"].includes(page)&&!LOADED_DETAIL_PAGES.has(page)){setMainContentLoading(true);loadDetailPageData(page).then(()=>{LOADED_DETAIL_PAGES.add(page);window.__isDataReady=true;rerenderCurrentPage({fromCache:false});}).catch(err=>{console.error("Lazy module load failed",err);setStatus("error",err?.message||"Gagal memuat modul");}).finally(()=>setMainContentLoading(false));return;}if(page==='dashboard'&&!DASHBOARD_SUMMARY){void loadDashboardPayload().catch(err=>console.error('Dashboard revalidation failed',err));}if(!window.__isDataReady){console.log("DATA READY", window.__isDataReady);return;}rerenderCurrentPage();}
function pageTitleFromPath(path){return String(path||"/").replace(/^\//,"").split("/").filter(Boolean).map(x=>x.replaceAll("-"," ").replace(/\b\w/g,c=>c.toUpperCase())).join(" / ")||"Dashboard";}
let lastLoggedPath=null;
function navigateTo(path){const from=location.pathname;if(path===from){routeFromPath(path);return;}history.pushState({},"",path);routeFromPath(path);if(user&&path!==lastLoggedPath){lastLoggedPath=path;logPageView({...currentUserIdentity(),module:pageTitleFromPath(path),page:path,from,to:path,details:{from,to:path}});}}
function navigateToSku(sku){const cleanSku=String(sku||"" ).trim();if(!cleanSku)return;navigateTo(`/sku/${encodeURIComponent(cleanSku)}`);}
function goBackToPreviousPage(){if(window.history.length>1){window.history.back();return;}navigateTo('/search');}
function showLoginView(){
if(isPreviewBypassLoginEnabled()){routeFromPath(location.pathname);return;}
authChecking=false;
user=null;
const loginForm=document.getElementById("loginForm");
const emailInput=document.getElementById("email");
const passwordInput=document.getElementById("password");
const rememberMeInput=document.getElementById("rememberMe");
if(loginForm)loginForm.reset();
if(emailInput)emailInput.value="";
if(passwordInput)passwordInput.value="";
if(rememberMeInput)rememberMeInput.checked=false;
renderAuthState();
bindLoginView();
}

function routeFromPath(path){
if(!user){
if(isPreviewBypassLoginEnabled()){history.replaceState({},"","/");return showPage("dashboard");}
return showLoginView();
}
if(path==="/")return showPage("dashboard");if(path==="/search")return showPage("search");if(path==="/barang-reject"||path==="/barang-reject/dashboard"){BARANG_REJECT_STATE.activeTab="dashboard";return showPage("barang-reject");}if(path==="/barang-reject/masuk"){BARANG_REJECT_STATE.activeTab="masuk";return showPage("barang-reject");}if(path==="/barang-reject/keluar"){BARANG_REJECT_STATE.activeTab="keluar";return showPage("barang-reject");}if(path==="/barang-reject/input"){BARANG_REJECT_STATE.activeTab="masuk";return showPage("barang-reject");}if(path==="/barang-masuk")return showPage("barang-masuk");if(path==="/barang-keluar")return showPage("barang-keluar");if(path==="/accuracy-dashboard"||path==="/accuracy"||path==="/dashboard-akurasi")return showPage("stats");if(path==="/abc-analisis")return showPage("abc-analisis");if(path==="/statistics"){history.replaceState({},"","/");return showPage("dashboard");}if(path==="/locations"||path==="/location"||path==="/lokasi")return showPage("locations");if(path==="/settings")return showPage("settings");if(path==="/sheet-input")return showPage("sheet-input");if(path==="/arsip")return showPage("arsip");if(path==="/asset-store")return showPage("asset-store");if(path==="/cycle-count")return showPage("cycle-count");if(path==="/movement")return showPage("movement");if(path==="/balikan-store")return showPage("balikan-store");if(path==="/import-pdf-transfer")return showPage("import-pdf-transfer");if(path==="/activity-log"){if(!isActivityLogAllowed()){history.replaceState({},"","/");return showPage("dashboard");}return showPage("activity-log");}if(path==="/tools-dev"){if(!isToolsDevAllowed()){history.replaceState({},"","/");return showPage("dashboard");}return showPage("tools-dev");}if(path==="/anomaly"){history.replaceState({},"","/warning");return showPage("anomaly");}if(path==="/warning")return showPage("anomaly");if(path==="/stok-minus")return showPage("stok-minus");if(path.startsWith("/sku/")){currentSku=decodeURIComponent(path.split("/sku/")[1]||"");showPage("detail");if(currentSku)showDetail(currentSku);return;}showPage("dashboard");}
function syncDeveloperMenuVisibility(){
const activityLogMenu=document.querySelector('.side-link[data-page="activity-log"]');
if(activityLogMenu)activityLogMenu.style.display=isActivityLogAllowed()?"":"none";
const toolsDevMenu=document.querySelector('.side-link[data-page="tools-dev"]');
if(toolsDevMenu)toolsDevMenu.style.display=isToolsDevAllowed()?"":"none";
}
function setupSidebar(){openSidebar.onclick=()=>document.body.classList.add("sidebar-open");closeSidebar.onclick=()=>closeSidebarFn();sidebarOverlay.onclick=()=>closeSidebarFn();initSidebarMenus();initSidebarCollapse();window.addEventListener("resize",handleDesktopSidebarMode);}
function getSidebarMenuState(){
const defaults={data:false,"monitoring-stok":false,inventory:false,"barang-reject":false,sistem:false};
const saved=safeJsonParse(localStorage.getItem(SIDEBAR_MENU_STATE_KEY),null,false);
return saved&&typeof saved==="object"?{...defaults,...saved}:defaults;
}
function setSidebarMenuOpen(key,isOpen,{persist=true}={}){
if(!key)return;
const group=document.querySelector(`[data-menu-group="${key}"]`),button=document.querySelector(`[data-sidebar-parent="${key}"]`);
if(!group||!button)return;
group.classList.toggle("is-open",isOpen);
button.setAttribute("aria-expanded",String(isOpen));
if(persist){const state=getSidebarMenuState();state[key]=isOpen;localStorage.setItem(SIDEBAR_MENU_STATE_KEY,JSON.stringify(state));}
}
function toggleSidebarMenu(key){
const group=document.querySelector(`[data-menu-group="${key}"]`);
setSidebarMenuOpen(key,!group?.classList.contains("is-open"));
}
function syncActiveSidebarParent(page){
document.querySelectorAll("[data-menu-group]").forEach(group=>{
const hasActive=!!group.querySelector(".side-link.active");
group.classList.toggle("has-active",hasActive);
if(hasActive)setSidebarMenuOpen(group.dataset.menuGroup,true,{persist:false});
});
}
function initSidebarMenus(){
const state=getSidebarMenuState();
document.querySelectorAll("[data-sidebar-parent]").forEach(btn=>setSidebarMenuOpen(btn.dataset.sidebarParent,state[btn.dataset.sidebarParent]!==false,{persist:false}));
const active=document.querySelector(".side-link[data-page].active");
if(active)syncActiveSidebarParent(active.dataset.page);
}

function initSidebarCollapse(){const saved=localStorage.getItem("sidebar_collapsed")==="true";const desktop=window.innerWidth>=900;document.body.classList.toggle("sidebar-collapsed",desktop&&saved);if(!sidebarToggle)return;sidebarToggle.onclick=()=>{if(window.innerWidth<900)return;const collapsed=document.body.classList.toggle("sidebar-collapsed");localStorage.setItem("sidebar_collapsed",String(collapsed));};}
function handleDesktopSidebarMode(){if(window.innerWidth<900){document.body.classList.remove("sidebar-collapsed");return;}const saved=localStorage.getItem("sidebar_collapsed")==="true";document.body.classList.toggle("sidebar-collapsed",saved);}
function closeSidebarFn(){document.body.classList.remove("sidebar-open");}
function closeSidebarMobile(){if(window.innerWidth<900)closeSidebarFn();}
async function openCacheDb(){
return await new Promise((resolve,reject)=>{
const req=indexedDB.open(IDB_NAME,IDB_VERSION);
req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(IDB_STORE))db.createObjectStore(IDB_STORE,{keyPath:"sheet"});};
req.onsuccess=()=>resolve(req.result);
req.onerror=()=>reject(req.error||new Error("Gagal membuka IndexedDB"));
});
}
async function loadCache(){
try{
const db=await openCacheDb();
const rows=await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,"readonly");const rq=tx.objectStore(IDB_STORE).getAll();rq.onsuccess=()=>resolve(rq.result||[]);rq.onerror=()=>reject(rq.error);});
const parsed={};
for(const sheet of [...INVENTORY_PRELOAD_SHEETS,"Barang Masuk","Barang Keluar"]){const hit=rows.find(r=>r.sheet===sheet);parsed[sheet]=Array.isArray(hit?.rows)?hit.rows:[];}
return parsed;
}catch(err){console.warn("IndexedDB load failed, fallback ke fetch API langsung", err);return null;}
}
async function saveCache(data){
try{
const db=await openCacheDb();
await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,"readwrite");const st=tx.objectStore(IDB_STORE);for(const sheet of [...INVENTORY_PRELOAD_SHEETS,"Barang Masuk","Barang Keluar"]){st.put({sheet,rows:Array.isArray(data?.[sheet])?data[sheet]:[],updatedAt:Date.now(),version:CACHE_VERSION});}tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);});
localStorage.setItem(CACHE_KEYS.lastSync,String(Date.now()));
localStorage.setItem(CACHE_KEYS.version,CACHE_VERSION);
updateSyncTime();
}catch(err){console.warn("IndexedDB save failed", err); }
}
function isCacheFresh(ttlMs=CACHE_FRESH_TTL_MS){const ts=Number(localStorage.getItem(CACHE_KEYS.lastSync)||0);return !!ts&&(Date.now()-ts)<ttlMs;}
function hasValidData(data){
return data && typeof data==="object" && Object.keys(data).some(key=>Array.isArray(data[key])&&data[key].length>0);
}
async function clearCache(){
try{const db=await openCacheDb();await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,"readwrite");const rq=tx.objectStore(IDB_STORE).clear();rq.onsuccess=()=>resolve(true);rq.onerror=()=>reject(rq.error);});}catch(_){}
localStorage.removeItem(CACHE_KEYS.lastSync);localStorage.removeItem(CACHE_KEYS.version);
}
function applyData(newData,{fromCache=false,deferRender=true}={}){
window.APP_STATE=window.APP_STATE||{};
const preservedMasuk=Array.isArray(window.APP_STATE.barangMasuk)?window.APP_STATE.barangMasuk:(Array.isArray(DATA["Barang Masuk"])?DATA["Barang Masuk"]:[]);
const preservedKeluar=Array.isArray(window.APP_STATE.barangKeluar)?window.APP_STATE.barangKeluar:(Array.isArray(DATA["Barang Keluar"])?DATA["Barang Keluar"]:[]);
for(const sheet of SHEETS){
if(sheet==="Barang Masuk"){DATA[sheet]=Array.isArray(newData?.[sheet])&&newData[sheet].length?newData[sheet]:preservedMasuk;continue;}
if(sheet==="Barang Keluar"){DATA[sheet]=Array.isArray(newData?.[sheet])&&newData[sheet].length?newData[sheet]:preservedKeluar;continue;}
DATA[sheet]=Array.isArray(newData?.[sheet])?newData[sheet]:[];
}
window.APP_STATE.barangMasuk=Array.isArray(DATA["Barang Masuk"])?DATA["Barang Masuk"]:[];
window.APP_STATE.barangKeluar=Array.isArray(DATA["Barang Keluar"])?DATA["Barang Keluar"]:[];
window.APP_STATE.data={...(newData||{}),barangMasuk:window.APP_STATE.barangMasuk,barangKeluar:window.APP_STATE.barangKeluar};
console.log("STATE SUMMARY",{
barangMasuk:window.APP_STATE.barangMasuk?.length||0,
barangKeluar:window.APP_STATE.barangKeluar?.length||0
});
const hasAnyData = SHEETS.some(sheet => (DATA[sheet]||[]).length>0);
window.__isDataReady = hasAnyData;
console.log("DATA READY", window.__isDataReady);
scheduleRebuildSkuCache();
apiConnected=true;
updateRefreshMeta({changed:true,fromCache});
updateApiState();
updateSyncTime();
updateSettings();
if(deferRender){scheduleUIWork(()=>rerenderCurrentPage({fromCache}));return;}
setMainContentLoading(false);
rerenderCurrentPage({fromCache});
}

function applyManualRefreshLastSync(){
const nowTs=Date.now();
localStorage.setItem(CACHE_KEYS.lastSync,String(nowTs));
console.log("MANUAL REFRESH UPDATE LAST SYNC",nowTs);
updateSyncTime();
if(typeof updateSettingsDashboard==='function')updateSettingsDashboard();
console.log("LAST SYNC UPDATED",localStorage.getItem(CACHE_KEYS.lastSync));
}

function scheduleUIWork(cb,{timeout=120,delay=16}={}){
const runner=()=>setTimeout(cb,delay);
if(typeof window.requestIdleCallback==="function")return window.requestIdleCallback(runner,{timeout});
return setTimeout(cb,delay);
}
function runChunked(items,worker,{chunkSize=500,timeout=80}={}){
const list=Array.isArray(items)?items:[];let index=0;
return new Promise((resolve,reject)=>{
const step=()=>{
try{const end=Math.min(index+chunkSize,list.length);for(;index<end;index++)worker(list[index],index);if(index<list.length){scheduleUIWork(step,{timeout,delay:0});return;}resolve();}
catch(err){reject(err);}
};
scheduleUIWork(step,{timeout,delay:0});
});
}
function updateRefreshMeta({module,changed=false,fromCache=false}={}){
const now=Date.now();
if(fromCache)REFRESH_STATE.cacheVersion+=1;
if(changed){REFRESH_STATE.dataVersion+=1;if(module)REFRESH_STATE.modules[module]=(REFRESH_STATE.modules[module]||0)+1;}
if(changed||fromCache)REFRESH_STATE.lastRefreshAt=now;
}
function setRefreshIndicator(active,msg="Refreshing..."){
REFRESH_STATE.isRefreshing=!!active;
if(active){setStatus("loading",msg);refreshToggleHeader?.classList.add("is-syncing");refreshToggleHeader?.setAttribute("aria-label",msg);}
else{refreshToggleHeader?.classList.remove("is-syncing");syncRefreshButton();}
updateSyncUI();
}
let renderTimer=null;
function scheduleRenderDashboard(){
clearTimeout(renderTimer);
renderTimer=setTimeout(()=>{renderDashboard();},100);
}
function getActivePage(){
const active=document.querySelector(".page:not(.hidden)");
return active?.id?.replace("page-","")||"dashboard";
}
function renderDashboard(){updateDashboard();}

function getBarangMasukRows(){return Array.isArray(window.APP_STATE?.barangMasuk)?window.APP_STATE.barangMasuk:[];}
function getBarangKeluarRows(){return Array.isArray(window.APP_STATE?.barangKeluar)?window.APP_STATE.barangKeluar:[];}
function sheetChecksum(rows){
const list=Array.isArray(rows)?rows:[];
const last=list.length?list[list.length-1]:null;
const tail=(last&&typeof last==="object")?Object.values(last).slice(0,4).join("|"):String(last??"");
return `${list.length}:${tail}`;
}
function buildRenderSignature(page=getActivePage()){
const masuk=getBarangMasukRows();
const keluar=getBarangKeluarRows();
const mLast=masuk.length?String(masuk[masuk.length-1]?.rowNumber??masuk[masuk.length-1]?.sku??""):"";
const kLast=keluar.length?String(keluar[keluar.length-1]?.rowNumber??keluar[keluar.length-1]?.sku??""):"";
const kartu=(DATA["Kartu Stock"]||[]);
const rpl=(DATA["RPL"]||[]);
const bulky=(DATA["BULKY"]||[]);
return `${page}|m:${masuk.length}:${mLast}|k:${keluar.length}:${kLast}|ks:${sheetChecksum(kartu)}|rpl:${sheetChecksum(rpl)}|bulky:${sheetChecksum(bulky)}|ready:${window.__isDataReady?"1":"0"}`;
}

function updateLocalRow(moduleName,rowNumber,field,value){
const stateKey=moduleName==='barang-masuk'?'barangMasuk':'barangKeluar';
window.APP_STATE=window.APP_STATE||{};
const rows=Array.isArray(window.APP_STATE[stateKey])?window.APP_STATE[stateKey]:[];
const row=rows.find(r=>Number(r.rowNumber)===Number(rowNumber));
if(row)row[field]=value;
window.APP_STATE[stateKey]=rows;
return rows;
}
function updateCacheRow(moduleName,rowNumber,field,value){
const cacheKey=moduleName==='barang-masuk'?MODULE_CACHE_KEYS.barangMasuk:MODULE_CACHE_KEYS.barangKeluar;
const rows=getCacheData(cacheKey)||[];
const row=rows.find(r=>Number(r.rowNumber)===Number(rowNumber));
if(row)row[field]=value;
setCacheSafe(cacheKey,rows);
setModuleCache(cacheKey,rows);
return rows;
}

function rerenderCurrentPage({fromCache=false}={}){
if(isRendering)return;
const currentPage=getActivePage();
const nextSignature=buildRenderSignature(currentPage);
if(hasRenderedInitial&&nextSignature===lastRenderedData)return;
isRendering=true;
try{
setMainContentLoading(false);
const page=currentPage;
if(page==="dashboard")updateDashboard();
if(page==="stats")updateStats();
if(page==="abc-analisis")renderAbcAnalisisPage();
if(page==="locations")renderLocationsPage();
if(page==="detail"&&currentSku)showDetail(currentSku);
if(page==="search"&&String(lastQuery||"").trim()){SEARCH_STATE.filterValue=lastQuery;runSearch();}
if(page==="barang-masuk")renderDataTablePage("in","Barang Masuk",true);
if(page==="barang-keluar")renderDataTablePage("out","Barang Keluar",true);
if(page==="anomaly")renderAnomalyPage();
if(page==="stok-minus")renderStokMinusPage();
if(page==="cycle-count")renderCycleCountPage();
if(page==="movement")renderMovementPage();
if(page==="barang-reject")renderBarangRejectPage();
if(page==="import-pdf-transfer")renderImportPdfTransferPage();
if(page==="activity-log")renderActivityLogPage();
if(page==="tools-dev")renderToolsDevPage();
if(page==="arsip")renderArchivePage();
if(page==="asset-store")renderAssetStorePage();
if(page==="balikan-store")renderBalikanTable(true);
if(fromCache)setStatus("ready","");
hasRenderedInitial=true;
lastRenderedData=nextSignature;
}finally{
isRendering=false;
}
}
async function refreshInventoryFull(){
setStatus("loading","Inventory refreshing...");
const freshData={};
const sheet="Kartu Stock";
const raw=await fetchSheet(sheet);
await new Promise(resolve=>scheduleUIWork(resolve));
freshData[sheet]=await routeFetchedSourceRows(sheet,raw,{chunked:true});
console.log("FETCH RESULT",sheet,Array.isArray(raw)?raw.length:0);
console.log("PARSED DATA",sheet,freshData[sheet].length);
return freshData;
}
async function refreshRplFull(){
const raw=await fetchSheet("RPL");
const rows=await routeFetchedSourceRows("RPL",raw,{chunked:true});
return rows;
}
async function refreshBulkyFull(){
const raw=await fetchSheet("BULKY");
const rows=await routeFetchedSourceRows("BULKY",raw,{chunked:true});
console.log("FETCH RESULT BULKY",Array.isArray(raw)?raw.length:0);
return rows;
}
async function refreshBarangMasukFull(){
const {res,data:json}=await fetchJsonSafe('/api/barang-masuk?mode=full');
if(!res.ok||!json?.success)throw new Error(json?.message||res.statusText||'Gagal refresh Barang Masuk');
const data=normalizeBackendRows(json);
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.barangMasuk=data;
setCacheSafe("barangMasukCache",data);
return data;
}
async function refreshBarangKeluarFull(){
const {res,data:json}=await fetchJsonSafe('/api/barang-keluar?mode=full');
if(!res.ok||!json?.success)throw new Error(json?.message||res.statusText||'Gagal refresh Barang Keluar');
const data=normalizeBackendRows(json);
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.barangKeluar=data;
setCacheSafe("barangKeluarCache",data);
return data;
}
async function refreshTransaksiFull({render=true}={}){
const [barangMasukRes,barangKeluarRes]=await Promise.allSettled([
refreshBarangMasukFull(),
refreshBarangKeluarFull()
]);
if(barangMasukRes.status==='fulfilled'){
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.barangMasuk=barangMasukRes.value;
DATA['Barang Masuk']=barangMasukRes.value;
setCacheSafe('barangMasukCache',barangMasukRes.value);
}else console.error('REFRESH ERROR BARANG MASUK',barangMasukRes.reason);
if(barangKeluarRes.status==='fulfilled'){
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.barangKeluar=barangKeluarRes.value;
DATA['Barang Keluar']=barangKeluarRes.value;
setCacheSafe('barangKeluarCache',barangKeluarRes.value);
}else console.error('REFRESH ERROR BARANG KELUAR',barangKeluarRes.reason);
if(render){
renderDataTablePage("in","Barang Masuk",true);
renderDataTablePage("out","Barang Keluar",true);
scheduleRenderDashboard();
}
return {barangMasukRes,barangKeluarRes};
}
async function refreshInventoryGroupFull(){
const [inventoryRes,rplRes,bulkyRes]=await Promise.allSettled([
refreshInventoryFull(),
refreshRplFull(),
refreshBulkyFull()
]);
const parsedKartuStock=inventoryRes.status==='fulfilled'&&Array.isArray(inventoryRes.value?.["Kartu Stock"])?inventoryRes.value["Kartu Stock"]:[];
const parsedRpl=rplRes.status==='fulfilled'&&Array.isArray(rplRes.value)?rplRes.value:[];
const parsedBulky=bulkyRes.status==='fulfilled'&&Array.isArray(bulkyRes.value)?bulkyRes.value:[];
DATA["Kartu Stock"]=parsedKartuStock;
DATA["RPL"]=parsedRpl;
DATA["BULKY"]=parsedBulky;
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.inventory={"Kartu Stock":parsedKartuStock,"RPL":parsedRpl,"BULKY":parsedBulky};
window.APP_STATE.data={...(window.APP_STATE.data||{}),...window.APP_STATE.inventory};
console.log("MANUAL REFRESH APPLY INVENTORY",{kartuStock:parsedKartuStock.length,rpl:parsedRpl.length,bulky:parsedBulky.length});
if(rplRes.status==='rejected')console.error('REFRESH ERROR RPL',rplRes.reason);
if(bulkyRes.status==='rejected')console.error('REFRESH ERROR BULKY',bulkyRes.reason);
return {inventoryRes,rplRes,bulkyRes,parsedKartuStock,parsedRpl,parsedBulky};
}
async function syncData({force=false,silent=true}={}){
if(REFRESH_STATE.isRefreshing||isSyncing){REFRESH_STATE.refreshQueue.push({force,silent,skippedAt:Date.now()});return REFRESH_STATE.refreshPromise||false;}
isSyncing=true;
setRefreshIndicator(true,"Refreshing...");
if(!force&&!silent&&Object.keys(DATA).length===0){setStatus("loading","Memuat data dari Google Sheets...");setMainContentLoading(true);}
if(silent)setStatus("loading","Sinkronisasi...");
try{
const prevMasuk=Array.isArray(DATA["Barang Masuk"])?DATA["Barang Masuk"]:[];
const prevKeluar=Array.isArray(DATA["Barang Keluar"])?DATA["Barang Keluar"]:[];
const prevKartu=Array.isArray(DATA["Kartu Stock"])?DATA["Kartu Stock"]:[];
const prevRpl=Array.isArray(DATA["RPL"])?DATA["RPL"]:[];
const prevBulky=Array.isArray(DATA["BULKY"])?DATA["BULKY"]:[];
const [inventorySyncRes,transaksiSyncRes]=await Promise.allSettled([
refreshInventoryGroupFull(),
refreshTransaksiFull({render:false}),
refreshBalikanStoreFull({background:true,force:true})
]);
const nextMasuk=Array.isArray(window.APP_STATE?.barangMasuk)?window.APP_STATE.barangMasuk:prevMasuk;
const nextKeluar=Array.isArray(window.APP_STATE?.barangKeluar)?window.APP_STATE.barangKeluar:prevKeluar;
if(transaksiSyncRes?.status==='rejected')console.error('REFRESH ERROR TRANSAKSI',transaksiSyncRes.reason);
const inventorySync=inventorySyncRes?.status==='fulfilled'?inventorySyncRes.value:null;
const nextKartu=Array.isArray(inventorySync?.parsedKartuStock)?inventorySync.parsedKartuStock:(Array.isArray(DATA["Kartu Stock"])?DATA["Kartu Stock"]:prevKartu);
const nextRpl=Array.isArray(inventorySync?.parsedRpl)?inventorySync.parsedRpl:(Array.isArray(DATA["RPL"])?DATA["RPL"]:prevRpl);
const nextBulky=Array.isArray(inventorySync?.parsedBulky)?inventorySync.parsedBulky:(Array.isArray(DATA["BULKY"])?DATA["BULKY"]:prevBulky);
const masukChanged=sheetChecksum(prevMasuk)!==sheetChecksum(nextMasuk);
const keluarChanged=sheetChecksum(prevKeluar)!==sheetChecksum(nextKeluar);
const kartuChanged=sheetChecksum(prevKartu)!==sheetChecksum(nextKartu);
const rplChanged=sheetChecksum(prevRpl)!==sheetChecksum(nextRpl);
const bulkyChanged=sheetChecksum(prevBulky)!==sheetChecksum(nextBulky);
const dataChanged=masukChanged||keluarChanged||kartuChanged||rplChanged||bulkyChanged;
DATA["Barang Masuk"]=nextMasuk;
console.log("MANUAL REFRESH APPLY BARANG MASUK",{rows:nextMasuk.length});
DATA["Barang Keluar"]=nextKeluar;
console.log("MANUAL REFRESH APPLY BARANG KELUAR",{rows:nextKeluar.length});
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.inventory={
"Kartu Stock":nextKartu,
"RPL":nextRpl,
"BULKY":nextBulky
};
window.APP_STATE.data={...(window.APP_STATE.data||{}),...window.APP_STATE.inventory,barangMasuk:nextMasuk,barangKeluar:nextKeluar};
window.mainDataCache={
"Kartu Stock":nextKartu,
"RPL":nextRpl,
"BULKY":nextBulky,
"Barang Masuk":nextMasuk,
"Barang Keluar":nextKeluar
};
scheduleRebuildSkuCache();

if(force){
if(dataChanged){
console.log("SAVE CACHE AFTER MANUAL REFRESH",{kartuStock:nextKartu.length,rpl:nextRpl.length,bulky:nextBulky.length,barangMasuk:nextMasuk.length,barangKeluar:nextKeluar.length});
await saveCache(DATA);
const cacheAfterSave=await loadCache();
console.log("CACHE AFTER SAVE Kartu Stock/RPL/BULKY",{
kartuStock:Array.isArray(cacheAfterSave?.["Kartu Stock"])?cacheAfterSave["Kartu Stock"].length:0,
rpl:Array.isArray(cacheAfterSave?.["RPL"])?cacheAfterSave["RPL"].length:0,
bulky:Array.isArray(cacheAfterSave?.["BULKY"])?cacheAfterSave["BULKY"].length:0
});
const runRender=()=>{
if(masukChanged)scheduleManualRefreshRender("in");
if(keluarChanged)scheduleManualRefreshRender("out");
console.log("RENDER AFTER MANUAL REFRESH",{page:getActivePage(),fromCache:false});
updateDashboard();
rerenderCurrentPage({fromCache:false});
};
if(typeof requestIdleCallback==='function')requestIdleCallback(runRender,{timeout:700});
else setTimeout(runRender,16);
}else{
if(manualRefreshNoticeTimer)clearTimeout(manualRefreshNoticeTimer);
setStatus('ok','Data sudah terbaru');
manualRefreshNoticeTimer=setTimeout(()=>setStatus('ok',''),1800);
}
}else{
const active=getActivePage();
if(active==="barang-masuk")scheduleManualRefreshRender("in");
else if(active==="barang-keluar")scheduleManualRefreshRender("out");
scheduleRenderDashboard();
if(dataChanged)await saveCache(DATA);
}
if(dataChanged)updateRefreshMeta({changed:true,module:"all"});
if(force)applyManualRefreshLastSync();
setStatus('ok','');
return true;
}catch(err){
apiConnected=false;updateApiState();
const hasCache=!!(await loadCache());
if(hasCache){setStatus('error','Gagal sync, memakai cache');return false;}
setStatus('error','Gagal memuat data: '+err.message);renderError('results','Data belum berhasil dimuat');renderState('dashboardCards','Data belum berhasil dimuat');throw err;
}finally{
isSyncing=false;
REFRESH_STATE.refreshPromise=null;
setRefreshIndicator(false);
hideInitialLoader();
setMainContentLoading(false);
}
}
function refreshTransaksiPageInBackground(page){
if(page!=="barang-masuk"&&page!=="barang-keluar")return;
const mode=page==="barang-masuk"?"in":"out";
setRefreshIndicator(true,"Refreshing...");
loadTransactionTablePage(mode,{page:TABLE_STATE[mode].page}).catch(err=>console.error("Background transaction page refresh error",err)).finally(()=>setRefreshIndicator(false));
}
async function loadDashboardSummary(){
const requestId=++dashboardSummaryRequestId;
const authGeneration=authRequestGeneration;
const startedAt=performance.now();
const headers=await getAuthHeaders();
const dashboardToday=getTodayDateKey();
const {res,data}=await fetchJsonSafe('/api/dashboard-summary'+`?today=${encodeURIComponent(dashboardToday)}`,{headers,cache:'no-store'});
const resolvedAt=performance.now();
if(requestId!==dashboardSummaryRequestId||authGeneration!==authRequestGeneration)return DASHBOARD_SUMMARY;
if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal memuat ringkasan dashboard');
DASHBOARD_SUMMARY=data.summary||{};
isSummaryOnlyLoaded=true;
isInitialDataLoaded=true;
window.__isDataReady=true;
apiConnected=true;
updateDashboard();
const renderedAt=performance.now();
console.info(`[dashboard] summary ${Math.round(resolvedAt-startedAt)} ms; rendered ${Math.round(renderedAt-startedAt)} ms; blocking tasks: none`);
hideInitialLoader();setMainContentLoading(false);updateApiState();
return DASHBOARD_SUMMARY;
}
async function loadDashboardRecentTransactions(){
const headers=await getAuthHeaders();const {res,data}=await fetchJsonSafe('/api/dashboard-recent-transactions',{headers,cache:'no-store'});
if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal memuat transaksi terbaru');
DASHBOARD_RECENT={barangMasuk:Array.isArray(data.barangMasuk)?data.barangMasuk:[],barangKeluar:Array.isArray(data.barangKeluar)?data.barangKeluar:[]};updateDashboard();return DASHBOARD_RECENT;
}
async function loadDashboardMonthlyInsight(){
const headers=await getAuthHeaders();const {res,data}=await fetchJsonSafe('/api/dashboard-monthly-insight',{headers,cache:'no-store'});
if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal memuat insight bulanan');
DASHBOARD_MONTHLY_INSIGHT=data.insight||null;updateDashboard();return DASHBOARD_MONTHLY_INSIGHT;
}
async function loadDashboardPayload(){
const results=await Promise.allSettled([loadDashboardSummary(),loadDashboardRecentTransactions(),loadDashboardMonthlyInsight()]);
if(results[0].status==='rejected')throw results[0].reason;
results.slice(1).forEach(result=>{if(result.status==='rejected')console.error('Dashboard optional section failed',result.reason);});
return DASHBOARD_SUMMARY;
}
function renderInventorySyncStatus(){
if(!lastSync)return;
if(inventorySyncStatusState==="loading"){lastSync.textContent="Memuat status sinkronisasi…";return;}
if(inventorySyncStatusState==="error"){lastSync.innerHTML="Status gagal dimuat · <button type='button' class='link-button' data-retry-sync-status>Coba lagi</button>";return;}
const dbSync=window.__inventorySyncStatus?.last_success_at;
if(!dbSync){lastSync.textContent="Belum sinkron";return;}
lastSync.textContent="Sinkron: "+new Date(dbSync).toLocaleString("id-ID",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
}
async function loadInventorySyncStatus(){
const requestId=++inventorySyncStatusRequestId;
const authGeneration=authRequestGeneration;
inventorySyncStatusState="loading";
renderInventorySyncStatus();
try{
const headers=await getAuthHeaders();
const {res,data}=await fetchJsonSafe('/api/inventory-sync-status',{headers});
if(requestId!==inventorySyncStatusRequestId||authGeneration!==authRequestGeneration)return null;
if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal memuat status sinkronisasi');
window.__inventorySyncStatus=data.syncStatus||null;
inventorySyncStatusState="loaded";
renderInventorySyncStatus();
return window.__inventorySyncStatus;
}catch(err){
if(requestId!==inventorySyncStatusRequestId||authGeneration!==authRequestGeneration)return null;
inventorySyncStatusState="error";
renderInventorySyncStatus();
throw err;
}
}
async function loadDetailPageData(page){
if(page==='barang-masuk')return loadTransactionTablePage('in',{page:TABLE_STATE.in.page});
if(page==='barang-keluar')return loadTransactionTablePage('out',{page:TABLE_STATE.out.page});
if(page==='balikan-store'){await loadBalikanSheets();return window.BALIKAN_ROWS;}
if(page==='locations')return renderLocationsPage();
return hydrateAllDataOnInit({force:false});
}
async function initAppData(){
if(hasInitializedDataFlow)return;
hasInitializedDataFlow=true;
console.log("INIT APP START");
console.log("CURRENT ROUTE", location.pathname);
window.APP_STATE=window.APP_STATE||{};

// Auth is fully established before these protected, summary-only startup reads.
// Keep their failures independent so neither is silently rendered as empty data.
// The prioritized coordinator already owns dashboard warming. Keep sync status
// independent and non-blocking so startup never duplicates protected requests.
void startInitialPrefetch();
void loadInventorySyncStatus().catch(error=>console.error("Inventory sync status failed",error));
const summaryFailure=null;

// The landing dashboard is summary-only. Detailed inventory is lazy-loaded only
// after navigating to a table/detail module, so startup avoids full-mode requests.
if(location.pathname==="/"||location.pathname==="/dashboard"){
if(summaryFailure){hasInitializedDataFlow=false;console.error("Dashboard summary failed",summaryFailure);setStatus("error",summaryFailure.message);dashboardCards.innerHTML=`<div class='state error'>Ringkasan dashboard gagal dimuat. <button type='button' class='link-button' data-retry-dashboard-summary>Coba lagi</button></div>`;hideInitialLoader();setMainContentLoading(false);}
return;
}
if(location.pathname==="/barang-masuk"||location.pathname==="/barang-keluar"){
// routeFromPath has already exposed the shell and started this request. Never
// make authentication/startup keep the transaction page behind a global loader.
hideInitialLoader();setMainContentLoading(false);return;
}
if(location.pathname==="/locations"||location.pathname==="/location"||location.pathname==="/lokasi"){hideInitialLoader();setMainContentLoading(false);return;}
if(location.pathname.startsWith("/sku/")){
// SKU detail owns its narrowly filtered request; never hydrate full inventory or
// transaction caches merely because a detail URL was opened directly.
hideInitialLoader();setMainContentLoading(false);return;
}

await hydrateModuleCachesFromDb();
const idbCache=await loadCache();
if(idbCache&&typeof idbCache==="object"){
if(Array.isArray(idbCache["Kartu Stock"])&&idbCache["Kartu Stock"].length)setModuleCache(MODULE_CACHE_KEYS.kartuStock,idbCache["Kartu Stock"]);
if(Array.isArray(idbCache["RPL"])&&idbCache["RPL"].length)setModuleCache(MODULE_CACHE_KEYS.rpl,idbCache["RPL"]);
if(Array.isArray(idbCache["BULKY"])&&idbCache["BULKY"].length)setModuleCache(MODULE_CACHE_KEYS.bulky,idbCache["BULKY"]);
if(Array.isArray(idbCache["Barang Masuk"])&&idbCache["Barang Masuk"].length)setModuleCache(MODULE_CACHE_KEYS.barangMasuk,idbCache["Barang Masuk"]);
if(Array.isArray(idbCache["Barang Keluar"])&&idbCache["Barang Keluar"].length)setModuleCache(MODULE_CACHE_KEYS.barangKeluar,idbCache["Barang Keluar"]);
}
const cachedBarangMasuk=getCacheData(MODULE_CACHE_KEYS.barangMasuk)||[];
const cachedBarangKeluar=getCacheData(MODULE_CACHE_KEYS.barangKeluar)||[];
const cachedKartuStock=getCacheData(MODULE_CACHE_KEYS.kartuStock)||[];
const cachedRpl=getCacheData(MODULE_CACHE_KEYS.rpl)||[];
const cachedBulky=getCacheData(MODULE_CACHE_KEYS.bulky)||[];
const cachedInventory={
  "Kartu Stock":Array.isArray(cachedKartuStock)?cachedKartuStock:[],
  "RPL":Array.isArray(cachedRpl)?cachedRpl:[],
  "BULKY":Array.isArray(cachedBulky)?cachedBulky:[]
};
const cachedMovement=getCacheData(MODULE_CACHE_KEYS.movement)||[];

window.APP_STATE.barangMasuk=Array.isArray(cachedBarangMasuk)?cachedBarangMasuk:[];
window.APP_STATE.barangKeluar=Array.isArray(cachedBarangKeluar)?cachedBarangKeluar:[];
window.APP_STATE.inventory=cachedInventory;
window.APP_STATE.movement=Array.isArray(cachedMovement)?cachedMovement:[];

console.log("CACHE LOAD",{
barangMasuk:window.APP_STATE.barangMasuk.length,
barangKeluar:window.APP_STATE.barangKeluar.length,
inventory:(window.APP_STATE.inventory?.["Kartu Stock"]?.length||0)+(window.APP_STATE.inventory?.["RPL"]?.length||0)+(window.APP_STATE.inventory?.["BULKY"]?.length||0),
movement:window.APP_STATE.movement.length
});

if(window.APP_STATE.barangMasuk.length||window.APP_STATE.barangKeluar.length||window.APP_STATE.inventory["Kartu Stock"].length||window.APP_STATE.inventory["RPL"].length||window.APP_STATE.inventory["BULKY"].length){
if(window.APP_STATE.inventory&&typeof window.APP_STATE.inventory==="object"){
applyData(window.APP_STATE.inventory,{fromCache:true,deferRender:true});
}
console.log("CACHE LOAD KARTU STOCK",(DATA["Kartu Stock"]||cachedInventory||[]).length);
console.log("CACHE LOAD RPL",(DATA["RPL"]||[]).length);
console.log("CACHE LOAD BULKY",(DATA["BULKY"]||[]).length);
isInitialDataApplied=true;
isInitialDataLoaded=true;
hideInitialLoader();
setMainContentLoading(false);
console.log("RENDER FROM CACHE");
if(!hasPreloadStarted&&!isCacheFresh()){
queueMicrotask(()=>{
startBackgroundPreload().catch(err=>console.warn("Background preload gagal",err));
refreshDataInBackground();
});
}
startAutoSync();
return;
}

if(hasValidData(window.mainDataCache)){
console.log("[initAppData] data dari window.mainDataCache");
await hydrateAllDataOnInit({force:false});
isInitialDataApplied=true;
isInitialDataLoaded=true;
hideInitialLoader();
setMainContentLoading(false);
rerenderCurrentPage();
startAutoSync();
if(!hasPreloadStarted&&!isCacheFresh())queueMicrotask(()=>startBackgroundPreload().catch(err=>console.warn("Background preload gagal",err)));
return;
}


if(preloadPromise){
try{
await preloadPromise;
if(window.APP_STATE?.inventory||window.APP_STATE?.barangMasuk?.length||window.APP_STATE?.barangKeluar?.length){
isInitialDataApplied=true;
isInitialDataLoaded=true;
hideInitialLoader();
setMainContentLoading(false);
rerenderCurrentPage({fromCache:true});
startAutoSync();
return;
}
}catch(err){
console.warn("Menunggu preload gagal, lanjut fallback",err);
}
}
const cachedData=await loadCache();
console.log("CACHE DATA", cachedData);
if(hasValidData(cachedData)){
window.mainDataCache=cachedData;
await hydrateAllDataOnInit({force:false});
isInitialDataApplied=true;
isInitialDataLoaded=true;
hideInitialLoader();
setMainContentLoading(false);
rerenderCurrentPage({fromCache:true});
startAutoSync();
if(window.mainDataPromise&&!isCacheFresh()){
window.mainDataPromise.then(async (preloadedData)=>{
if(!hasValidData(preloadedData))return;
console.log("[initAppData] refresh dari window.mainDataPromise setelah cache");
applyData(preloadedData,{deferRender:true});
await saveCache(preloadedData);
rerenderCurrentPage();
updateRefreshMeta({changed:true,module:"movement"});
}).catch(err=>console.warn("Preload utama gagal setelah cache",err));
}
return;
}

if(window.mainDataPromise){
try{
const preloadedData=await window.mainDataPromise;
console.log("[initAppData] data dari window.mainDataPromise");
if(hasValidData(preloadedData)){
window.mainDataCache=preloadedData;
await hydrateAllDataOnInit({force:false});
isInitialDataApplied=true;
isInitialDataLoaded=true;
hideInitialLoader();
setMainContentLoading(false);
rerenderCurrentPage();
startAutoSync();
if(!hasPreloadStarted&&!isCacheFresh())queueMicrotask(()=>startBackgroundPreload().catch(err=>console.warn("Background preload gagal",err)));
return;
}
}catch(err){
console.warn("Preload utama gagal, lanjut cache/fetch biasa",err);
}
}

try{
await hydrateAllDataOnInit({force:true});
isInitialDataLoaded=true;
}catch(err){
console.warn("Fallback fetch gagal", err);
}
if(!window.__isDataReady){
setStatus("error","Data belum siap dimuat");
}
startAutoSync();
}
async function refreshDataInBackground(){
if(!isInitialDataLoaded)return;
if(REFRESH_STATE.isRefreshing)return;
if(isPreloadStarted&&!isPreloadFinished)return;
if(isCacheFresh())return;
console.log("BACKGROUND REFRESH START");
setRefreshIndicator(true,"Refreshing...");
try{
const [barangMasuk,barangKeluar]=await Promise.allSettled([
loadBarangMasuk({mode:"full"}),
loadBarangKeluar({mode:"full"})
]);
const inventoryRes=await Promise.allSettled(INVENTORY_PRELOAD_SHEETS.map(sheet=>fetchSheet(sheet).then(raw=>routeFetchedSourceRows(sheet,raw,{chunked:true}))));
if(barangMasuk.status==="fulfilled"&&Array.isArray(barangMasuk.value)&&barangMasuk.value.length){
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.barangMasuk=barangMasuk.value;
setCacheSafe(MODULE_CACHE_KEYS.barangMasuk,barangMasuk.value);
}
if(barangKeluar.status==="fulfilled"&&Array.isArray(barangKeluar.value)&&barangKeluar.value.length){
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.barangKeluar=barangKeluar.value;
setCacheSafe(MODULE_CACHE_KEYS.barangKeluar,barangKeluar.value);
}
let inventoryChanged=false;
for(let i=0;i<INVENTORY_PRELOAD_SHEETS.length;i++){
if(inventoryRes[i]?.status!=="fulfilled")continue;
const sheet=INVENTORY_PRELOAD_SHEETS[i];
const nextRows=Array.isArray(inventoryRes[i].value)?inventoryRes[i].value:[];
const prevRows=Array.isArray(DATA[sheet])?DATA[sheet]:[];
if(sheetChecksum(prevRows)!==sheetChecksum(nextRows)){
DATA[sheet]=nextRows;
inventoryChanged=true;
}
}
const prevMasuk=Array.isArray(DATA["Barang Masuk"])?DATA["Barang Masuk"]:[];
const prevKeluar=Array.isArray(DATA["Barang Keluar"])?DATA["Barang Keluar"]:[];
const nextMasuk=Array.isArray(window.APP_STATE?.barangMasuk)?window.APP_STATE.barangMasuk:[];
const nextKeluar=Array.isArray(window.APP_STATE?.barangKeluar)?window.APP_STATE.barangKeluar:[];
const changed=prevMasuk.length!==nextMasuk.length||prevKeluar.length!==nextKeluar.length;
if(changed){
DATA["Barang Masuk"]=nextMasuk;
console.log("MANUAL REFRESH APPLY BARANG MASUK",{rows:nextMasuk.length});
DATA["Barang Keluar"]=nextKeluar;
console.log("MANUAL REFRESH APPLY BARANG KELUAR",{rows:nextKeluar.length});
rerenderCurrentPage();
updateRefreshMeta({changed:true,module:"movement"});
}
if(inventoryChanged||changed)await saveCache(DATA);
}catch(err){
console.error("Background refresh error",err);
}finally{setRefreshIndicator(false);}
}
function getLastSyncTs(){return Number(localStorage.getItem(CACHE_KEYS.lastSync)||0);}
function shouldAutoSyncNow(){const ts=getLastSyncTs();return !ts||Date.now()-ts>=AUTO_SYNC_INTERVAL_MS;}
function maybeAutoSync(){if(REFRESH_STATE.isRefreshing||isSyncing)return;if(shouldAutoSyncNow())syncData({force:true,silent:true});}
function startAutoSync(){
maybeAutoSync();
setInterval(maybeAutoSync,AUTO_SYNC_CHECK_INTERVAL_MS);
startInventoryVersionWatcher();
}

const INVENTORY_VERSION_STATE={versions:null,inFlight:null,controller:null,generation:0,timer:null,lastCheckAt:0};
function comparableInventoryVersions(payload){return Object.fromEntries(Object.entries(payload||{}).filter(([key])=>key.endsWith('Version')));}
function changedInventorySources(previous,next){return Object.keys(next).filter(key=>previous?.[key]!==next[key]);}
async function refreshVisibleInventoryPage(changed,generation){
const page=getActivePage();
setRefreshIndicator(true,'Memperbarui data...');
try{
if(page==='barang-masuk'&&changed.includes('barangMasukVersion')){TRANSACTION_PAGE_CACHE.clearSource('barang_masuk');await loadTransactionTablePage('in',{page:TABLE_STATE.in.page,force:true,background:true});}
else if(page==='barang-keluar'&&changed.includes('barangKeluarVersion')){TRANSACTION_PAGE_CACHE.clearSource('barang_keluar');await loadTransactionTablePage('out',{page:TABLE_STATE.out.page,force:true,background:true});}
else if(page==='dashboard'){await loadDashboardPayload();}
else if(page==='anomaly'){await refreshAnomalyInBackground();}
else if(page==='detail'&&currentSku){await showDetail(currentSku,{background:true});}
else if(page==='locations'&&changed.some(key=>['kartuStokVersion','rplVersion','bulkyVersion'].includes(key))){LOCATION_STATE.summary=null;LOCATION_STATE.pageCache.clear();LOCATION_STATE.detailCache.clear();await Promise.all([loadLocationSummary(),loadLocationPage(LOCATION_STATE.page),loadEmptyLocations(LOCATION_STATE.emptyPage)]);if(LOCATION_STATE.selected)await selectLocationDetail(encodeURIComponent(LOCATION_STATE.selected));}
if(generation===INVENTORY_VERSION_STATE.generation)toast('Data diperbarui','success');
}finally{if(generation===INVENTORY_VERSION_STATE.generation)setRefreshIndicator(false);}
}
async function checkInventoryVersion(){
if(!user||document.hidden||navigator.onLine===false)return;
if(INVENTORY_VERSION_STATE.inFlight)return INVENTORY_VERSION_STATE.inFlight;
const controller=new AbortController();INVENTORY_VERSION_STATE.controller=controller;const generation=++INVENTORY_VERSION_STATE.generation;
INVENTORY_VERSION_STATE.inFlight=(async()=>{try{const {res,data}=await fetchJsonSafe('/api/inventory-version',{signal:controller.signal});if(!res.ok||data?.success===false)throw new Error(data?.message||'Gagal memeriksa versi inventory');if(generation!==INVENTORY_VERSION_STATE.generation)return;const next=comparableInventoryVersions(data),previous=INVENTORY_VERSION_STATE.versions;INVENTORY_VERSION_STATE.versions=next;INVENTORY_VERSION_STATE.lastCheckAt=Date.now();if(previous){const changed=changedInventorySources(previous,next);if(changed.length){DASHBOARD_SUMMARY=null;DASHBOARD_MONTHLY_INSIGHT=null;}if(changed.includes('barangMasukVersion'))TRANSACTION_PAGE_CACHE.markSourceStale('barang_masuk');if(changed.includes('barangKeluarVersion'))TRANSACTION_PAGE_CACHE.markSourceStale('barang_keluar');if(changed.some(key=>['kartuStokVersion','rplVersion','bulkyVersion'].includes(key))){LOCATION_STATE.summary=null;LOCATION_STATE.pageCache.clear();STARTUP_PREFETCH.warningSummary=null;}if(changed.length)await refreshVisibleInventoryPage(changed,generation);}}catch(err){if(err?.name!=='AbortError')console.warn('[InventoryVersion]',err?.message||err);}finally{if(generation===INVENTORY_VERSION_STATE.generation){INVENTORY_VERSION_STATE.inFlight=null;INVENTORY_VERSION_STATE.controller=null;}}})();
return INVENTORY_VERSION_STATE.inFlight;
}
function startInventoryVersionWatcher(){
if(INVENTORY_VERSION_STATE.timer)return;
INVENTORY_VERSION_STATE.timer=setInterval(checkInventoryVersion,INVENTORY_VERSION_CHECK_INTERVAL_MS);
document.addEventListener('visibilitychange',()=>{if(document.hidden)INVENTORY_VERSION_STATE.controller?.abort();else checkInventoryVersion();});
window.addEventListener('focus',()=>{if(Date.now()-INVENTORY_VERSION_STATE.lastCheckAt>5000)checkInventoryVersion();});
window.addEventListener('offline',()=>INVENTORY_VERSION_STATE.controller?.abort());
window.addEventListener('online',checkInventoryVersion);
checkInventoryVersion();
}

async function loadAllData(manual=true,silent=false){return syncData({force:!!manual,silent:!!silent});}
async function loadBarangMasuk(_opts={}){
const {mode="full",limit=1000}=_opts||{};
const qs=mode==="latest"?`?mode=latest&limit=${Number(limit)||1000}`:`?mode=full`;
const {res,data:json}=await fetchJsonSafe(`/api/barang-masuk${qs}`);
if(!res.ok||!json?.success)throw new Error((json&&json.message)||res.statusText||'Gagal membaca Barang Masuk dari Supabase');
const barangMasukRows=normalizeBackendRows(json);
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.barangMasuk=barangMasukRows;
setModuleCache(MODULE_CACHE_KEYS.barangMasuk,window.APP_STATE.barangMasuk);
setCacheSafe(MODULE_CACHE_KEYS.barangMasuk,window.APP_STATE.barangMasuk);
console.log("DASHBOARD BARANG MASUK", window.APP_STATE.barangMasuk?.length);
return barangMasukRows;
}
async function loadBarangKeluar(_opts={}){
const {mode="full",limit=1000}=_opts||{};
const qs=mode==="latest"?`?mode=latest&limit=${Number(limit)||1000}`:`?mode=full`;
const {res,data:json}=await fetchJsonSafe(`/api/barang-keluar${qs}`);
if(!res.ok||!json?.success)throw new Error((json&&json.message)||res.statusText||'Gagal membaca Barang Keluar dari Supabase');
const barangKeluarRows=normalizeBackendRows(json);
window.APP_STATE=window.APP_STATE||{};
window.APP_STATE.barangKeluar=barangKeluarRows;
setModuleCache(MODULE_CACHE_KEYS.barangKeluar,window.APP_STATE.barangKeluar);
setCacheSafe(MODULE_CACHE_KEYS.barangKeluar,window.APP_STATE.barangKeluar);
console.log("DASHBOARD BARANG KELUAR", window.APP_STATE.barangKeluar?.length);
return barangKeluarRows;
}
const FRONTEND_SOURCE_ROUTES=Object.freeze({
'Kartu Stock':{kind:'supabase',endpoint:'/api/kartu-stok?mode=full'},
'Kartu Stok':{kind:'supabase',endpoint:'/api/kartu-stok?mode=full'},
'Barang Masuk':{kind:'supabase',endpoint:'/api/barang-masuk?mode=full'},
'Barang Keluar':{kind:'supabase',endpoint:'/api/barang-keluar?mode=full'},
'RPL':{kind:'supabase',endpoint:'/api/rpl?mode=full'},
'BULKY':{kind:'supabase',endpoint:'/api/bulky?mode=full'},
'BARCODE':{kind:'sheets'}
});
function getFrontendSourceRoute(sourceName){
const route=FRONTEND_SOURCE_ROUTES[sourceName];
if(route)return route;
throw new Error(`${sourceName}: source frontend tidak didukung`);
}
async function fetchSheet(sheetName){
const route=getFrontendSourceRoute(sheetName);
if(sheetName==='Barang Masuk')return loadBarangMasuk({mode:'full'});
if(sheetName==='Barang Keluar')return loadBarangKeluar({mode:'full'});
if(route.kind==='supabase'){
const {res,data:json}=await fetchJsonSafe(route.endpoint);
if(!res.ok||!json?.success)throw new Error(json?.message||res.statusText||`Gagal membaca ${sheetName} dari Supabase`);
if(sheetName==='Kartu Stock'||sheetName==='Kartu Stok')window.__kartuStokSyncStatus=json.syncStatus||null;
if(sheetName==='BULKY'){
window.__bulkyLastSync=json.lastSync||null;
window.__bulkySyncStatus=json.syncStatus||null;
}
return Array.isArray(json.rows)?json.rows:(Array.isArray(json.data)?json.data:[]);
}
// BARCODE is a separate, non-inventory source that has not migrated to Supabase.
const range=`${sheetName}!A1:ZZ`;
const url=`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
const res=await fetch(url);
const json=await res.json();
if(!res.ok||json.error) throw new Error(`${sheetName}: ${(json.error&&json.error.message)||res.statusText}`);
return json.values||[];
}
function parseSheet(values){if(!Array.isArray(values)||!values.length)return[];const h=detectHeaderIndex(values);if(h<0)return[];const headers=values[h].map((v,i)=>normalizeHeader(v)||`col_${i+1}`);const rows=[];for(let r=h+1;r<values.length;r++){const row=values[r]||[];if(!row.length||row.every(c=>!String(c||"").trim()))continue;const obj={};headers.forEach((k,i)=>obj[k]=row[i]||"");rows.push(obj);}return rows;}
function routeFetchedSourceRows(sourceName,payload,{chunked=false}={}){
const route=getFrontendSourceRoute(sourceName);
if(route.kind==='supabase'){
if(!Array.isArray(payload)||payload.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new TypeError(`${sourceName}: respons Supabase harus berupa object rows`);
return payload;
}
return chunked?parseSheetChunked(payload):parseSheet(payload);
}
async function parseSheetChunked(values){
if(!Array.isArray(values)||!values.length)return[];
const h=detectHeaderIndex(values);if(h<0)return[];
const headers=values[h].map((v,i)=>normalizeHeader(v)||`col_${i+1}`);const rows=[];const body=values.slice(h+1);
await runChunked(body,(row)=>{if(!row?.length||row.every(c=>!String(c||"").trim()))return;const obj={};headers.forEach((k,i)=>obj[k]=row[i]||"");rows.push(obj);},{chunkSize:600,timeout:120});
return rows;
}
function splitBarcodeTokens(raw){
return String(raw||"").split(/[\n,;|]+/).map(v=>cleanScannedSku(v)).filter(Boolean);
}
function parseBarcodeSheet(values){
if(!Array.isArray(values)||values.length<2)return[];
const rows=[];
for(let r=1;r<values.length;r++){
const row=Array.isArray(values[r])?values[r]:[];
const sku=String(row[0]||"").trim();
const nama=String(row[2]||"").trim();
if(!sku)continue;
const barcodeSet=new Set();
for(let i=1;i<row.length;i++)splitBarcodeTokens(row[i]).forEach(code=>barcodeSet.add(code));
const barcodes=[...barcodeSet];
if(!barcodes.length)continue;
rows.push({sku,nama,barcodes});
}
return rows;
}
function rebuildBarcodeMap(rows=[]){
BARCODE_STATE.barcodeToSku=new Map();
BARCODE_STATE.barcodeToName=new Map();
for(const item of rows){
const sku=String(item?.sku||"").trim();
const nama=String(item?.nama||"").trim();
const list=Array.isArray(item?.barcodes)?item.barcodes:splitBarcodeTokens(item?.barcode||"");
for(const barcode of list){
const key=cleanScannedSku(barcode);
if(!sku||!key)continue;
BARCODE_STATE.barcodeToSku.set(key,sku);
if(nama)BARCODE_STATE.barcodeToName.set(key,nama);
}
}
BARCODE_STATE.loaded=true;
BARCODE_STATE.updatedAt=Date.now();
}
async function loadBarcodeMaster({force=false}={}){
if(!force&&BARCODE_STATE.loaded&&BARCODE_STATE.barcodeToSku.size)return BARCODE_STATE;
try{
const raw=await fetchSheet("BARCODE");
const rows=parseBarcodeSheet(raw);
rebuildBarcodeMap(rows);
console.log("BARCODE MASTER LOADED",rows.length);
}catch(err){
console.warn("Gagal load BARCODE master",err);
if(!BARCODE_STATE.loaded){
BARCODE_STATE.barcodeToSku=new Map();
BARCODE_STATE.barcodeToName=new Map();
BARCODE_STATE.loaded=true;
}
}
return BARCODE_STATE;
}
function detectHeaderIndex(values){if(!Array.isArray(values))return-1;const req=["sku","nama","nama barang","item","description","qty","tanggal","from","to","lokasi"];let bi=-1,bs=0;for(let i=0;i<Math.min(values.length,25);i++){if(!Array.isArray(values[i]))continue;const t=values[i].map(clean).join("|");let s=0;req.forEach(k=>t.includes(clean(k))&&s++);if(s>bs){bs=s;bi=i;}}return bs>=1?bi:-1;}
function withAlphaNumericSearchVariants(value){const base=normalizeSearch(value);const joined=base.replace(/(\d)\s+([a-z])/g,"$1$2").replace(/([a-z])\s+(\d)/g,"$1$2");return joined&&joined!==base?`${base} ${joined}`:base;}
function getRowSearchText(row){return withAlphaNumericSearchVariants([
  getVal(row,["sku","kode sku","item code"]),
  getVal(row,["barcode","kode barcode"]),
  getVal(row,["nama barang","nama","item","item name","description"]),
  getVal(row,["lokasi","location","rak","bin","area"]),
  getVal(row,["keterangan","catatan","remark","remarks","note","notes"]),
  getVal(row,["status","status barang","status proses"]),
  getVal(row,["invent","inventory","inventaris"]),
  Object.values(row||{}).filter(value=>typeof value!=="object").join(" ")
].join(" "));}
let skuCacheBuildToken=0;
function rebuildSkuCache(){scheduleRebuildSkuCache();}
function scheduleRebuildSkuCache(){
const token=++skuCacheBuildToken;const next=new Map();const sheets=[...INVENTORY_PRELOAD_SHEETS,"Barang Masuk","Barang Keluar"];
(async()=>{
for(const sheet of sheets){
const rows=DATA[sheet]||[];
await runChunked(rows,(row)=>{const sku=getVal(row,["sku"]);const name=getVal(row,["nama barang","nama","item","description"]);const key=clean(sku||name);if(!key)return;if(!next.has(key))next.set(key,{sku:sku||"-",nama:name||"-",sources:new Set(),rows:[],_searchText:"",_skuClean:"",_nameClean:"",_skuDigits:""});const it=next.get(key);it.sources.add(sheet);it.rows.push({sheet,row});},{chunkSize:700,timeout:120});
if(token!==skuCacheBuildToken)return;
}
await runChunked([...next.values()],(it)=>{const rowsText=(it.rows||[]).map(x=>getRowSearchText(x?.row)).filter(Boolean).join(" ");it._skuClean=normalizeSearch(it.sku||"");it._nameClean=normalizeSearch(it.nama||"");it._skuDigits=String(it.sku||"").replace(/\D/g,"");it._searchText=normalizeSearch(`${it.sku||""} ${it.nama||""} ${rowsText}`);},{chunkSize:500,timeout:120});
if(token===skuCacheBuildToken)CACHE_SKU=next;
})().catch(err=>console.warn("SKU cache build failed",err));
}
function scheduleSearchFilter(nextValue){
SEARCH_STATE.inputValue=String(nextValue||"");
clearTimeout(SEARCH_STATE.debounceTimer);
if(SEARCH_STATE.abortController)SEARCH_STATE.abortController.abort();
const token=++SEARCH_STATE.runToken;
SEARCH_STATE.debounceTimer=setTimeout(()=>{
const run=()=>{if(token!==SEARCH_STATE.runToken)return;SEARCH_STATE.filterValue=SEARCH_STATE.inputValue;runSearch();};
if(typeof requestIdleCallback==="function"){requestIdleCallback(run,{timeout:250});return;}
if(SEARCH_STATE.idleTimer)clearTimeout(SEARCH_STATE.idleTimer);
SEARCH_STATE.idleTimer=setTimeout(run,0);
},SEARCH_STATE.debounceMs);
}
async function runSearch(){const qRaw=SEARCH_STATE.filterValue||"",q=normalizeSearch(qRaw),prevQuery=lastQuery;lastQuery=qRaw;const minChars=SEARCH_STATE.minChars||2;if(q.length<minChars){lastResults=[];SEARCH_STATE.page=1;renderQuickResultCard(null,qRaw,"hint");return renderState("results",q?`Ketik minimal ${minChars} huruf untuk mencari.`:`Ketik minimal ${minChars} huruf untuk mencari.`);}saveRecentSearch(qRaw);if(SEARCH_STATE.abortController)SEARCH_STATE.abortController.abort();SEARCH_STATE.abortController=new AbortController();const signal=SEARCH_STATE.abortController.signal;renderState("results","Mencari di database...");try{const headers=await getAuthHeaders();const filter=currentFilter==="Semua"?"":`&source=${encodeURIComponent(currentFilter)}`;const {res,data}=await fetchJsonSafe(`/api/inventory-search?q=${encodeURIComponent(qRaw)}${filter}`,{headers,signal,cache:'no-store'});if(signal.aborted)return;if(!res.ok||!data?.success)throw new Error(data?.message||"Pencarian gagal");const nextResults=Array.isArray(data.rows)?data.rows:[];if(nextResults.length!==lastResults.length||normalizeSearch(prevQuery)!==q)SEARCH_STATE.page=1;lastResults=nextResults;renderQuickResultCard(pickQuickResult(lastResults,qRaw),qRaw,nextResults.length?"result":"empty");renderResults(lastResults,qRaw);}catch(err){if(err?.name!=="AbortError")renderError("results",err.message||"Pencarian gagal");}}

function getScannerConfig(){
return {
fps:20,
qrbox:(viewfinderWidth,viewfinderHeight)=>{
const minEdge=Math.min(viewfinderWidth,viewfinderHeight);
const size=Math.floor(minEdge*0.7);
return {width:size,height:size};
},
aspectRatio:1,
disableFlip:false,
useBarCodeDetectorIfSupported:true,
formatsToSupport:[
window.Html5QrcodeSupportedFormats.QR_CODE,
window.Html5QrcodeSupportedFormats.CODE_128,
window.Html5QrcodeSupportedFormats.EAN_13,
window.Html5QrcodeSupportedFormats.EAN_8,
window.Html5QrcodeSupportedFormats.UPC_A,
window.Html5QrcodeSupportedFormats.UPC_E
]
};
}

function playScanSuccessFeedback(){
if(navigator.vibrate){
navigator.vibrate(100);
}
}
function cleanScannedSku(text){
const raw=String(text||"").trim();
const match=raw.match(/\d{8,20}/);
return match?match[0]:raw;
}
function normalizeScannedSku(scannedValue){
return String(scannedValue??"").trim();
}
function findSkuByBarcode(barcode){
const key=cleanScannedSku(barcode);
if(!key)return null;
const sku=BARCODE_STATE.barcodeToSku.get(key);
if(!sku)return null;
return {barcode:key,sku:String(sku).trim()};
}
async function resolveScannedSku(rawText){
const cleaned=cleanScannedSku(rawText);
if(!cleaned)return {scanned:"",sku:"",mapped:false};
const headers=await getAuthHeaders();
if(!headers.Authorization)throw new Error("AUTH_REQUIRED");
const response=await nativeFetch(`/api/barcode-lookup?barcode=${encodeURIComponent(cleaned)}`,{headers});
const contentType=String(response.headers.get("content-type")||"").toLowerCase();
if(!contentType.includes("application/json")){
const text=String(await response.text()).trim();
throw new Error(`Barcode lookup failed: HTTP ${response.status}${text?` ${text}`:""}`);
}
const payload=await response.json();
if(!response.ok||payload?.success!==true)throw new Error(payload?.error||`Barcode lookup failed: HTTP ${response.status}`);
return {scanned:cleaned,sku:String(payload?.sku||"").trim(),mapped:payload?.found===true};
}
function triggerSearchSku(sku){
SEARCH_STATE.inputValue=sku;
SEARCH_STATE.filterValue=sku;
runSearch();
}
function openSkuDetailIfFound(sku){
const key=clean(sku);
const exact=lastResults.find(r=>clean(r.sku)===key);
if(!exact)return false;
navigateTo('/sku/'+encodeURIComponent(exact.sku));
return true;
}
function handleSearchScanResult(scannedValue){
const sku=normalizeScannedSku(scannedValue);
if(!sku)return;
const now=Date.now();
if(SCANNER_STATE.lastSearchSku===sku&&now-SCANNER_STATE.lastSearchNavigationAt<SEARCH_SCAN_NAVIGATION_LOCK_MS)return;
SCANNER_STATE.lastSearchSku=sku;
SCANNER_STATE.lastSearchNavigationAt=now;
const input=document.getElementById("searchInput");
if(input)input.value=sku;
navigateTo(`/sku/${encodeURIComponent(sku)}`);
logActivity({
...currentUserIdentity(),
action:"SCAN_BARCODE_SKU",
module:"Search",
detail:`User scan SKU: ${sku}`,
reference:sku,
status:"SUCCESS",
metadata:{
sku,
source:"barcode_scanner"
}
}).catch(()=>{});
toast(`SKU berhasil dipindai: ${sku}`,"success");
}
async function openBarcodeScanner(targetInputId="searchInput",onResult=handleSearchScanResult){
SCANNER_STATE.targetInputId=targetInputId;
SCANNER_STATE.resultHandler=typeof onResult==="function"?onResult:handleSearchScanResult;
return openScannerModal();
}
async function openScannerModal(){
if(!["/search","/balikan-store","/movement"].includes(location.pathname)&&!location.pathname.startsWith("/barang-reject"))return;
if(typeof window.Html5Qrcode!=="function")return toast("Scanner belum tersedia.","error");
const modal=document.getElementById("scannerModal"),readerId="barcode-reader";
if(!modal||SCANNER_STATE.isScannerRunning)return;
modal.hidden=false;
document.body.classList.add("scanner-modal-open");
if(window.lucide)window.lucide.createIcons();
try{
SCANNER_STATE.instance=new window.Html5Qrcode(readerId);
SCANNER_STATE.isScannerRunning=true;
SCANNER_STATE.isClosing=false;
SCANNER_STATE.hasScanned=false;
const config=getScannerConfig();
const onSuccess=async(decodedText)=>{
if(SCANNER_STATE.isClosing||SCANNER_STATE.hasScanned||!decodedText)return;
SCANNER_STATE.hasScanned=true;
playScanSuccessFeedback();
const resultHandler=SCANNER_STATE.resultHandler;
const closePromise=closeScannerModal();
resultHandler?.(decodedText);
await closePromise;
};
try{
await SCANNER_STATE.instance.start({facingMode:{exact:"environment"}},config,onSuccess,()=>{});
}catch(_cameraErr){
await SCANNER_STATE.instance.start({facingMode:"environment"},config,onSuccess,()=>{});
}
setTimeout(()=>{
const video=document.querySelector("#barcode-reader video");
if(video){
video.setAttribute("playsinline",true);
video.setAttribute("webkit-playsinline",true);
video.muted=true;
video.autoplay=true;
video.play().catch(()=>{});
}
},300);
}catch(err){
SCANNER_STATE.isScannerRunning=false;
SCANNER_STATE.hasScanned=false;
SCANNER_STATE.instance=null;
modal.hidden=true;
document.body.classList.remove("scanner-modal-open");
toast(err?.message||"Gagal membuka kamera scanner.","error");
}
}
async function closeScannerModal(){
const modal=document.getElementById("scannerModal");
if(!modal)return;
SCANNER_STATE.isClosing=true;
if(SCANNER_STATE.instance&&SCANNER_STATE.isScannerRunning){try{await SCANNER_STATE.instance.stop();}catch(_){}}
if(SCANNER_STATE.instance){try{await SCANNER_STATE.instance.clear();}catch(_){}}
SCANNER_STATE.instance=null;
SCANNER_STATE.isScannerRunning=false;
SCANNER_STATE.hasScanned=false;
SCANNER_STATE.isClosing=false;
modal.hidden=true;
document.body.classList.remove("scanner-modal-open");
}

function pickQuickResult(items,query){
const q=clean(query||"");
if(!q){selectedQuickSku="";return null;}
const selected=selectedQuickSku?[...(items||[])].find(r=>clean(r.sku)===clean(selectedQuickSku)):null;
if(selected)return selected;
if((items||[]).length===1)return items[0];
const exact=(items||[]).find(r=>clean(r.sku)===q||clean(r.nama)===q||(/^[0-9]{4}$/.test(q)&&String(r.sku||"").replace(/\D/g,"").endsWith(q)));
return exact||null;
}
function sumRowQty(row,sheet){
const keys=sheet==="Kartu Stock"?["stok akhir","closing stock","ending stock","saldo akhir","qty","stok"]:["qty","quantity","jumlah","stok akhir","stock","stok"];
for(const key of keys){const val=getVal(row,[key]);if(String(val??"").trim()!=="")return parseNumber(val);}
return 0;
}
function buildQuickResultSummary(item){
if(!item)return null;
const sku=item.sku||"-",nama=item.nama||"-";
const distribution={"Kartu Stock":0,RPL:0,BULKY:0};
const lokasiSet=new Set();
(item.rows||[]).forEach(({sheet,row})=>{
const loc=getVal(row,["lokasi","location","rak","bin","area","from","to"]);
if(loc)lokasiSet.add(String(loc));
if(Object.prototype.hasOwnProperty.call(distribution,sheet))distribution[sheet]+=sumRowQty(row,sheet);
});
const locations=[...lokasiSet].filter(Boolean).sort((a,b)=>a.localeCompare(b));
const totalQty=Object.values(distribution).reduce((n,v)=>n+(Number(v)||0),0);
let status={label:"Stok Kritis",icon:"🔴",cls:"critical"};
if(totalQty>=20)status={label:"Stok Aman",icon:"🟢",cls:"safe"};
else if(totalQty>=5)status={label:"Stok Menipis",icon:"🟡",cls:"low"};
return {sku,nama,distribution,locations,totalQty,totalLocations:locations.length,status};
}
function renderQuickResultCard(item,query,mode="hint"){
const node=document.getElementById("quickResultCard");
if(!node)return;
if(!clean(query||"")){
node.innerHTML=`<div class='quick-result-card quick-result-empty'><div class='quick-empty-icon'>💡</div><div><strong>Cari SKU, 4 digit akhir SKU, barcode, atau nama barang.</strong><div class='subtitle'>Contoh:<br>5750<br>milk frother<br>storage box</div></div></div>`;
return;
}
if(!item){node.innerHTML=mode==="empty"?`<div class='quick-result-card quick-result-empty'><div class='quick-empty-icon'>🔎</div><div><strong>Belum ada Quick Result.</strong><div class='subtitle'>Pilih salah satu hasil pencarian untuk melihat ringkasan instan.</div></div></div>`:"";return;}
const s=buildQuickResultSummary(item);if(!s)return;
const locText=s.locations.length?s.locations.join(", "):"-";
node.innerHTML=`<div class='quick-result-card' data-quick-sku='${encAttr(s.sku)}'>
  <div class='quick-main'><div class='quick-name'>📦 ${esc(s.nama)}</div><div class='quick-sku'>SKU: <strong>${esc(s.sku)}</strong></div><div class='quick-total'>Total Stok: <strong>${esc(s.totalQty)} pcs</strong></div></div>
  <div class='quick-locations'><div class='quick-label'>Lokasi</div><div class='quick-location-text' title='${encAttr(locText)}'>${esc(locText)}</div><div class='quick-ops'><span>Total Lokasi: <strong>${s.totalLocations}</strong></span><span>Total Qty: <strong>${s.totalQty}</strong></span><span class='quick-stock-status ${s.status.cls}'>${s.status.icon} ${s.status.label}</span></div></div>
  <div class='quick-distribution'><div class='quick-label'>Distribusi</div><div>Kartu Stock : <strong>${esc(s.distribution["Kartu Stock"])} pcs</strong></div><div>RPL : <strong>${esc(s.distribution.RPL)} pcs</strong></div><div>BULKY : <strong>${esc(s.distribution.BULKY)} pcs</strong></div></div>
  <div class='quick-actions' aria-label='Action cepat'><button class='copy-mini-btn quick-icon-btn' type='button' title='Copy SKU' aria-label='Copy SKU' onclick="copyText(decodeURIComponent('${encAttr(s.sku)}'),'SKU disalin',this)">📋<span>SKU</span></button><button class='copy-mini-btn quick-icon-btn' type='button' title='Copy Nama Barang' aria-label='Copy Nama Barang' onclick="copyText(decodeURIComponent('${encAttr(s.nama)}'),'Nama barang disalin',this)">📋<span>Nama</span></button><button class='copy-mini-btn quick-icon-btn' type='button' title='Copy Semua Lokasi' aria-label='Copy Semua Lokasi' onclick="copyText(decodeURIComponent('${encAttr(locText)}'),'Lokasi disalin',this)">📋<span>Lokasi</span></button></div>
</div>`;
}
function selectQuickResult(sku){selectedQuickSku=sku||"";const picked=[...(lastResults||[])].find(r=>clean(r.sku)===clean(sku));renderQuickResultCard(picked,lastQuery,picked?"result":"empty");}

function changeSearchPage(delta){if(!delta)return;const totalPage=Math.max(1,Math.ceil(lastResults.length/SEARCH_STATE.pageSize));SEARCH_STATE.page=Math.max(1,Math.min(totalPage,SEARCH_STATE.page+delta));renderResults(lastResults,lastQuery);}
function renderResults(items,query){if(!items.length){renderQuickResultCard(null,query,"empty");return renderState("results","Data tidak ditemukan.");}const total=items.length;const totalPage=Math.max(1,Math.ceil(total/SEARCH_STATE.pageSize));if(SEARCH_STATE.page>totalPage)SEARCH_STATE.page=totalPage;const startIdx=(SEARCH_STATE.page-1)*SEARCH_STATE.pageSize;const pageItems=items.slice(startIdx,startIdx+SEARCH_STATE.pageSize);const start=total?startIdx+1:0,end=Math.min(startIdx+SEARCH_STATE.pageSize,total);const resultsNode=document.getElementById("results");if(!resultsNode)return;resultsNode.innerHTML=`<div class='subtitle'>${total} hasil.</div><div class='result-list'></div><div class='mv-pagination'><span>Menampilkan ${start}–${end} dari ${total} data</span><div class='row'><button class='btn-ghost' data-search-page='-1'>Prev</button><button class='btn-ghost' data-search-page='1'>Next</button></div></div>`;const listNode=resultsNode.querySelector(".result-list");pageItems.forEach(r=>{const card=document.createElement("div");card.className="result-card";card.tabIndex=0;card.setAttribute("role","button");card.addEventListener("click",e=>{if(e.target.closest("button"))return;selectQuickResult(r.sku);});card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();selectQuickResult(r.sku);}});const badgesHtml=r.sources.filter(s=>!['Barang Masuk','Barang Keluar'].includes(s)).map(s=>`<span class='badge ${badgeClass(s)}'>${esc(s)}</span>`).join(" ");card.innerHTML=`<div class='result-head'><div><strong data-highlight='nama'></strong><div>SKU: <span data-highlight='sku'></span></div></div><div>${badgesHtml}</div></div><div class='row'><button class='btn-ghost copy-mini-btn' data-copy-sku onclick="copySku(decodeURIComponent('${encAttr(r.sku)}'),this)"><span aria-hidden='true'>⧉</span><span>Copy SKU</span></button><button class='btn-primary' onclick="navigateTo('/sku/'+encodeURIComponent(decodeURIComponent('${encAttr(r.sku)}')))">Lihat Detail</button></div>`;const namaEl=card.querySelector("[data-highlight='nama']");const skuEl=card.querySelector("[data-highlight='sku']");highlightText(r.nama,query).forEach(node=>namaEl.append(node));highlightText(r.sku,query).forEach(node=>skuEl.append(node));listNode?.append(card);});}
let skuDetailRequestId=0;
async function showDetail(identifier,{background=false,throwOnError=false}={}){
const sku=String(identifier||"").trim();
if(!sku)return renderState("detail","Detail tidak tersedia.");
const requestId=++skuDetailRequestId;
if(!background)renderState("detail","Memuat detail SKU...");
try{
const {res,data}=await fetchJsonSafe(`/api/inventory-sku-detail?sku=${encodeURIComponent(sku)}`,{cache:'no-store'});
if(requestId!==skuDetailRequestId||currentSku!==sku)return;
if(!res.ok||!data?.success)throw new Error(data?.message||"Gagal memuat detail SKU");
if(!data.found)return renderState("detail",`SKU ${sku} tidak ditemukan.`);
renderSkuDetailPayload(data);
}catch(err){
if(requestId!==skuDetailRequestId||currentSku!==sku)return;
if(!background)detail.innerHTML=`<div class="state error">Gagal memuat detail SKU<br><button type="button" class="btn-primary" onclick="showDetail(decodeURIComponent('${encAttr(sku)}'))">Coba Lagi</button></div>`;
if(throwOnError)throw err;
}
}
function renderSkuDetailPayload(payload){
const sku=String(payload.sku||"").trim();
const bySheet=payload.sources||{};
const allRows=Object.values(bySheet).flatMap(rows=>Array.isArray(rows)?rows:[]);
const nama=String(getVal(allRows.find(row=>getVal(row,["nama barang","namaBarang","nama_barang"]))||{},["nama barang","namaBarang","nama_barang"])||sku);
const sel={sku,nama,sources:Object.entries(bySheet).filter(([,rows])=>Array.isArray(rows)&&rows.length).map(([name])=>name)};
const inRows=bySheet["Barang Masuk"]||[],outRows=bySheet["Barang Keluar"]||[];
const tIn=inRows.reduce((n,r)=>n+parseNumber(getVal(r,["qty"])),0),tOut=outRows.reduce((n,r)=>n+parseNumber(getVal(r,["qty"])),0);
const kartuRows=bySheet["Kartu Stock"]||[];
const tAvailable=kartuRows.reduce((n,r)=>n+parseNumber(getVal(r,["stok akhir","closing stock","ending stock","saldo akhir"])),0);
const tStokBulky=(bySheet["BULKY"]||[]).reduce((n,r)=>n+parseNumber(getVal(r,["stok akhir","closing stock","ending stock","saldo akhir","qty","stok","quantity"])),0);
const tStokRetail=(bySheet["RPL"]||[]).reduce((n,r)=>n+parseNumber(getVal(r,["stok akhir","closing stock","ending stock","saldo akhir","qty","stok","quantity"])),0);
const locationSet=new Set();
for(const r of (bySheet["Kartu Stock"]||[])){const stokAkhir=parseNumber(getVal(r,["stok akhir","closing stock","ending stock","saldo akhir"]));if(stokAkhir<=0)continue;for(const k of Object.keys(r||{})){const nk=clean(k);if(["lokasi","location","rak","bin","area"].some(x=>nk.includes(x))){const v=r[k];if(v)locationSet.add(String(v).trim());}}}
const summary=[["Total Stok Akhir",tAvailable],["Stok Retail",tStokRetail],["Stok Bulky",tStokBulky],["Total Qty Masuk",tIn],["Total Qty Keluar",tOut],["Baris Kartu Stock",bySheet["Kartu Stock"].length]];
const sourceList=Array.isArray(sel.sources)?sel.sources:[...sel.sources||[]];
let html=`<div class='detail-profile'><div class='detail-hero'><div class='detail-top'><div><div class='detail-name'>${esc(nama)}</div><div class='detail-sku'>SKU: <strong>${esc(sku)}</strong> <button class='btn-ghost copy-mini-btn' data-copy-sku onclick="copySku(decodeURIComponent('${encAttr(sku)}'),this)"><span aria-hidden='true'>⧉</span><span>Copy SKU</span></button></div></div><button class='btn-primary' onclick="goBackToPreviousPage()"><span aria-hidden='true'>←</span><span>Kembali ke hasil pencarian</span></button></div><div class='source-row'>${sourceList.map(s=>`<span class='badge ${badgeClass(s)}'>${esc(s)}</span>`).join(" ")}</div></div>`;
html+=`<div class='summary-grid'>${summary.map(([k,v])=>`<div class='summary-card'><div class='k'>${k}</div><div class='v'>${esc(v)}</div></div>`).join("")}</div>`;
html+=`<div class='detail-note'><div class='note-box'><div class='note-title'>Lokasi</div><div class='note-value'>${locationSet.size?[...locationSet].slice(0,12).map(esc).join(", "):"-"}</div></div></div>`;
for(const sheet of [...INVENTORY_PRELOAD_SHEETS,"Barang Masuk","Barang Keluar"]){const rows=bySheet[sheet];html+=`<details class='source-card' ${rows.length?'open':''}><summary><span><span class='badge ${badgeClass(sheet)}'>${sheet}</span></span><span>${rows.length} baris</span></summary><div class='source-body'>${renderSkuDetailTable(sheet,rows)}</div></details>`;}
html+="</div>";detail.innerHTML=html;}
const SKU_DETAIL_LOCATION_FIELDS=new Set(["lokasi","lokasi bulky","lokasi_bulky","lokasiBulky"]);
function getSkuDetailPresentationCells(row){const source=row&&typeof row==="object"?row:{};const canonical=String(source.lokasi??"").trim();const bulky=String(source.lokasi_bulky??source.lokasiBulky??source["lokasi bulky"]??"").trim();const cells={lokasi:canonical||bulky};for(const [key,value] of Object.entries(source)){if(!SKU_DETAIL_LOCATION_FIELDS.has(key))cells[key]=value;}return cells;}
const SKU_DETAIL_INTERNAL_COLUMNS=new Set(["rownumber","sourcerownumber","syncedat"]);
function isSkuDetailInternalColumn(key){return SKU_DETAIL_INTERNAL_COLUMNS.has(String(key??"").replace(/[^a-z0-9]/gi,"").toLowerCase());}
function getSkuDetailVisibleCells(row){const cells={};for(const [key,value] of Object.entries(row&&typeof row==="object"?row:{})){if(!isSkuDetailInternalColumn(key))cells[key]=value;}return cells;}
function renderSkuDetailTable(sheet,rows){const inventoryPresentation=INVENTORY_PRELOAD_SHEETS.includes(sheet)?getSkuDetailPresentationCells:null;return renderTable(rows,row=>getSkuDetailVisibleCells(inventoryPresentation?inventoryPresentation(row):row));}
function isSafeDocumentUrl(value){try{const url=new URL(String(value||"").trim());return url.protocol==="https:"||url.protocol==="http:";}catch(_error){return false;}}
function renderDocumentValue(value){return isSafeDocumentUrl(value)?`<a class='document-link-btn' href='${esc(String(value).trim())}' target='_blank' rel='noopener noreferrer' aria-label='Lihat Dokumen'><span aria-hidden='true'>📄</span><span>Lihat</span></a>`:`<span class='document-empty' aria-label='Dokumen tidak tersedia'>Tidak Ada</span>`;}
function renderStockoutValue(value){const normalized=String(value??"").trim().toLowerCase();if(!normalized)return `<span class='stockout-empty' aria-label='Status stock out tidak tersedia'>—</span>`;const isStockout=value===true||["true","yes","ya","1"].includes(normalized);const label=isStockout?"Stock Out":"Tidak Stock Out";return `<span class='stockout-badge ${isStockout?"is-yes":"is-no"}' role='img' aria-label='${label}' title='${label}'><span aria-hidden='true'>${isStockout?"✓":"×"}</span></span>`;}
function renderPresentationValue(key,value){return key==="dokumen"?renderDocumentValue(value):key==="stockout"?renderStockoutValue(value):esc(value??"");}
function renderTable(rows,presentRow=null){if(!rows.length) return `<div class='empty-card'><strong>Data kosong</strong><div>Tidak ada baris untuk sumber ini.</div></div>`;const presented=presentRow?rows.map(presentRow):rows;const headers=Object.keys(presented[0]);let h=`<div class='table-wrap'><table><thead><tr>${headers.map(x=>`<th>${esc(String(x).toUpperCase())}</th>`).join("")}</tr></thead><tbody>`;presented.forEach(r=>h+=`<tr>${headers.map(k=>`<td class='${k==="dokumen"||k==="stockout"?"presentation-cell":""}'>${renderPresentationValue(k,r[k])}</td>`).join("")}</tr>`);h+=`</tbody></table></div><div class='mv-pagination'><span>Menampilkan ${rows.length} dari ${rows.length} data</span></div>`;return h;}

function renderInsightCard(insight){
if(!insight||insight.empty)return `<div class='insight-card insight-card--empty'><div class='state'>Belum ada data untuk dianalisis</div></div>`;
if(Array.isArray(insight.insights)){
const items=insight.insights.slice(0,10).map(it=>`<li class='auto-insight-list-item tone-${esc(it.tone||'info')}'><span class='auto-insight-list-icon'>${it.icon||'•'}</span><span class='auto-insight-list-text'>${it.text||''}</span></li>`).join('');
const important=insight.important?`<div class='auto-insight-important tone-${esc(insight.important.tone||'info')}'><strong>${insight.important.icon||'💡'} Insight Terpenting Hari Ini:</strong> <span>${insight.important.text||''}</span></div>`:'';
return `<section class='insight-card auto-insight-panel auto-insight-panel--compact'><div class='auto-insight-title'><div><h4>${esc(insight.title||'💡 Auto Insight Bulanan')}</h4><p>${esc(insight.subtitle||'Insight otomatis berdasarkan aktivitas gudang bulan ini.')}</p></div><span class='auto-insight-period'>${esc(insight.monthLabel||'Bulan ini')}</span></div>${important}<ul class='auto-insight-list'>${items||'<li class="auto-insight-list-item tone-info"><span class="auto-insight-list-icon">💡</span><span class="auto-insight-list-text">Belum ada insight prioritas untuk bulan ini.</span></li>'}</ul></section>`;
}
return `<div class='insight-card'>${(insight.categories||[]).map(cat=>`<div class='insight-group'><h4>${cat.title}</h4><ul>${cat.items.map(it=>`<li><span class='insight-dot'>•</span><span>${it}</span></li>`).join("")}</ul></div>`).join("")}</div>`;
}
function normalizeStatus(value){return String(value??"").trim().toLowerCase();}
function isBarangMasukCountRow(row){return normalizeStatus(getVal(row,["status","status movement","status_movement","movement status"]))==="barang masuk";}
function isBarangMasukTableRow(row){const status=normalizeStatus(getVal(row,["status","status movement","status_movement","movement status"]));return status==="barang masuk"||status==="movement";}
function debugBarangMasukRows(rows,label="Barang Masuk",predicate=isBarangMasukCountRow){
const normalizedRows=Array.isArray(rows)?rows:[];
const included=normalizedRows.filter(predicate);
const uniqueStatuses=[...new Set(normalizedRows.map(row=>normalizeStatus(getVal(row,["status","status movement","status_movement","movement status"]))).filter(Boolean))].slice(0,20);
console.table([{source:label,totalRawRows:normalizedRows.length,totalStatusBarangMasuk:included.length,totalExcludedRows:normalizedRows.length-included.length,uniqueStatusSamples:uniqueStatuses.join(", ")}]);
return included;
}
function updateDashboard(){if(DASHBOARD_SUMMARY&&isSummaryOnlyLoaded){const s=DASHBOARD_SUMMARY;const cards=[
{name:"Total SKU",value:s.totalSku||0},{name:"Baris Kartu Stock",value:s.kartuStok||0},{name:"Baris RPL",value:s.rpl||0},{name:"Baris BULKY",value:s.bulky||0},
{name:"Barang Masuk",value:s.barangMasuk||0,delta:`+${s.barangMasukHariIni||0} hari ini`,deltaClass:"metric-delta metric-delta--in"},
{name:"Barang Keluar",value:s.barangKeluar||0,delta:`+${s.barangKeluarHariIni||0} hari ini`,deltaClass:"metric-delta metric-delta--out"},
{name:"Total Movement",value:s.totalMovement||0,delta:`+${s.totalMovementHariIni||0} hari ini`,deltaClass:"metric-delta metric-delta--neutral"},
{name:"Stok Minus",value:s.minusStock||0}
];dashboardCards.innerHTML=cards.map(c=>`<div class='metric'><div class='k'>${c.name}</div><div class='row' style='justify-content:space-between;align-items:center;gap:8px'><div class='v'>${c.value}</div>${c.delta?`<div class='${c.deltaClass||"metric-delta"}'>${c.delta}</div>`:""}</div></div>`).join("");recentMove.innerHTML=`${DASHBOARD_MONTHLY_INSIGHT?renderInsightCard(DASHBOARD_MONTHLY_INSIGHT):"<div class='state'>Memuat insight bulanan…</div>"}<div class='dashboard-sections'>${renderDashboardTableSection("Barang Masuk","Data terbaru dari Barang Masuk",DASHBOARD_RECENT.barangMasuk,"b-in")}${renderDashboardTableSection("Barang Keluar","Data terbaru dari Barang Keluar",DASHBOARD_RECENT.barangKeluar,"b-out")}</div>`;return;}const skuSet=new Set();const totals={};SHEETS.forEach(s=>{const sourceRows=s==="Barang Masuk"?getBarangMasukRows():s==="Barang Keluar"?getBarangKeluarRows():(DATA[s]||[]);totals[s]=sourceRows.length;if(s==="Barang Masuk")totals[s]=sourceRows.filter(r=>clean(getVal(r,["sku"]))).length;sourceRows.forEach(r=>{const sku=getVal(r,["sku"]);if(sku)skuSet.add(clean(sku));});});
const lokasiTerpakaiSet=new Set();(DATA["Kartu Stock"]||[]).forEach(r=>{const lokasiRaw=getVal(r,["lokasi","location","rak","bin","area"]);const stokAkhir=parseNumber(getVal(r,["stok akhir","closing stock","ending stock","saldo akhir"]));if(!lokasiRaw||stokAkhir<=0)return;const parsed=parseLocationCode(lokasiRaw);if(parsed.valid&&!parsed.blocked)lokasiTerpakaiSet.add(parsed.raw);});
const TOTAL_LOKASI_AKTIF=getAllValidLocations().length,lokasiTerpakai=lokasiTerpakaiSet.size,lokasiTersisa=Math.max(TOTAL_LOKASI_AKTIF-lokasiTerpakai,0);
const barangMasukRows=debugBarangMasukRows(getBarangMasukRows(),"Dashboard",isBarangMasukCountRow);
console.log("RENDER BARANG MASUK", getBarangMasukRows().length);
const inSummary=getDailyMovementSummary(barangMasukRows,"all");
const outSummary=getDailyMovementSummary(getBarangKeluarRows(),"pengeluaran");
console.log("RENDER BARANG KELUAR", getBarangKeluarRows().length);
const movementSummary=getDailyStatusSummary(getBarangMasukRows(),"movement");
const cards=[
{name:"Total SKU",value:skuSet.size},
{name:"Baris Kartu Stock",value:totals["Kartu Stock"]},
{name:"Baris RPL",value:totals["RPL"]},
{name:"Baris BULKY",value:totals["BULKY"]},
{name:"Barang Masuk",value:inSummary.totalCount,delta:`+${inSummary.todayCount} hari ini`,deltaClass:"metric-delta metric-delta--in"},
{name:"Barang Keluar",value:outSummary.totalCount,delta:`+${outSummary.todayCount} hari ini`,deltaClass:"metric-delta metric-delta--out"},
{name:"Total Movement",value:movementSummary.totalCount,delta:`+${movementSummary.todayCount} hari ini`,deltaClass:"metric-delta metric-delta--neutral"},
{name:"Lokasi tersisa",value:lokasiTersisa}
];
dashboardCards.innerHTML=cards.map(c=>`<div class='metric'><div class='k'>${c.name}</div><div class='row' style='justify-content:space-between;align-items:center;gap:8px'><div class='v'>${c.value}</div>${c.delta?`<div class='${c.deltaClass||"metric-delta"}'>${c.delta}</div>`:""}</div></div>`).join("");
const inRows=getLatestRows("Barang Masuk",50,true),outRows=getLatestRows("Barang Keluar",50);
const dashInsight=buildAutoInsight({"Barang Masuk":getBarangMasukRows(),"Barang Keluar":getBarangKeluarRows(),"Kartu Stock":DATA["Kartu Stock"]||[],"RPL":DATA["RPL"]||[],"BULKY":DATA["BULKY"]||[]},{movementRows:window.APP_STATE?.movement||[],accuracyRows:window.ACCURACY_ROWS||[],anomalyRows:window.ANOMALY_ROWS||[],stokMinusRows:window.STOK_MINUS_ROWS||[],balikanRows:window.BALIKAN_ROWS||[],barangReject:BARANG_REJECT_STATE});
recentMove.innerHTML=`${renderInsightCard(dashInsight)}<div class='dashboard-sections'>
${renderDashboardTableSection("Barang Masuk","Data terbaru dari sheet Barang Masuk",inRows,"b-in")}
${renderDashboardTableSection("Barang Keluar","Data terbaru dari sheet Barang Keluar",outRows,"b-out")}
</div>`;}
function getLatestRows(sheetName,limit=50,requireSku=false){let rows=(sheetName==="Barang Masuk"?getBarangMasukRows():sheetName==="Barang Keluar"?getBarangKeluarRows():(DATA[sheetName]||[])).slice();if((sheetName==="Barang Masuk"||sheetName==="Barang Keluar")){const latestRows=rows.slice(-limit).reverse();if(rows.length>0&&latestRows.length===0)console.warn(`BUG latestRows kosong padahal rows ada untuk ${sheetName}`);return latestRows;}if(requireSku)rows=rows.filter(r=>clean(getVal(r,["sku"])));return rows.reverse().slice(0,limit);}
function getDailyStatusSummary(rows,expectedStatus){
const todayKey=getTodayDateKey();
let totalCount=0,todayCount=0;
for(const row of rows){
const status=clean(getVal(row,["status","status movement","status_movement","movement status"]));
if(!status.includes(clean(expectedStatus)))continue;
const dateKey=parseDateKey(getVal(row,["tanggal","date","created at","waktu"]));
if(!dateKey)continue;
totalCount++;
if(dateKey===todayKey)todayCount++;
}
return{totalCount,todayCount};
}
function getDailyMovementSummary(rows,expectedType){
const todayKey=getTodayDateKey();
let totalQty=0,todayQty=0;
let totalCount=0,todayCount=0;
for(const row of rows){
if(expectedType!=="all"&&clean(getVal(row,["keterangan","description","tipe"]))!==clean(expectedType))continue;
const qty=Math.abs(parseNumber(getVal(row,["qty"])));
const dateKey=parseDateKey(getVal(row,["tanggal","date","created at","waktu"]));
if(!dateKey)continue;
totalCount++;
totalQty+=qty;
if(dateKey===todayKey){todayQty+=qty;todayCount++;}
}
return{totalQty,todayQty,totalCount,todayCount};
}
function getTodayDateKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function parseSheetDate(value){
if(!value)return null;
const str=String(value).trim();
if(/^\d{4}-\d{2}-\d{2}/.test(str)){const d=new Date(str);return Number.isNaN(d.getTime())?null:d;}
const parts=str.split("/");
if(parts.length===3){
const a=Number(parts[0]),b=Number(parts[1]);let y=Number(parts[2]);
if(y<100)y+=2000;
const d=new Date(y,a-1,b);
return Number.isNaN(d.getTime())?null:d;
}
const d=new Date(str);
return Number.isNaN(d.getTime())?null:d;
}
function parseDateKey(value){
const d=parseSheetDate(value);if(!d)return "";
return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function renderDashboardTableSection(title,subtitle,rows,badgeClassName){const badgeText=`${rows.length} terbaru`;return `<section class='dashboard-section'><div class='card'><div class='section-header'><div><h4>${esc(title)}</h4><small class='section-subtitle'>${esc(subtitle)}</small></div><span class='badge ${badgeClassName}'>${esc(badgeText)}</span></div>${renderDashboardSheetTable(rows,title)}</div></section>`;}
function renderDashboardSheetTable(rows,title){if(!rows.length)return `<div class='empty-card'><strong>Data kosong</strong><div>Belum ada data pada section ${esc(title)}.</div></div>`;const isMovement=title==="Barang Masuk"||title==="Barang Keluar";if(isMovement){const headers=["Tanggal","From","To","SKU","Nama Barang","Qty","Status","PIC","Keterangan"];const extract=(row,i,key)=>{if(Array.isArray(row))return row[i]??"";return row?.[key]??row?.[String(i)]??"";};const tr=rows.map(row=>{const mapped={tanggal:extract(row,0,"tanggal"),from:extract(row,1,"from"),to:extract(row,2,"to"),sku:extract(row,3,"sku"),namaBarang:getVal(row,["namaBarang","nama barang","nama","item","description"])||extract(row,4,"namaBarang"),qty:extract(row,5,"qty"),status:extract(row,6,"status"),pic:extract(row,7,"pic"),keterangan:extract(row,8,"keterangan")};return `<tr><td>${esc(mapped.tanggal)}</td><td>${esc(mapped.from)}</td><td>${esc(mapped.to)}</td><td>${esc(mapped.sku)}</td><td>${esc(mapped.namaBarang)}</td><td>${esc(mapped.qty)}</td><td>${esc(mapped.status)}</td><td>${esc(mapped.pic)}</td><td>${esc(mapped.keterangan)}</td></tr>`;}).join("");const th=headers.map(h=>`<th>${esc(h)}</th>`).join("");return `<div class='table-scroll'><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;}const headers=[];rows.forEach(row=>Object.keys(row||{}).forEach(k=>{if(!headers.includes(k))headers.push(k);}));const th=headers.map(h=>`<th>${esc(String(h).toUpperCase())}</th>`).join("");const tr=rows.map(row=>`<tr>${headers.map(k=>`<td>${esc(row[k]??"")}</td>`).join("")}</tr>`).join("");return `<div class='table-scroll'><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;}
function normMv(row,type,sheet){
const sku=getVal(row,["sku"])||"-";
const nama=getVal(row,["nama barang","nama","item","description"])||"-";
const qty=parseNumber(getVal(row,["qty"]));
const tanggal=getVal(row,["tanggal","date","created at","waktu"])||"-";
return{sku,nama,qty,tanggal,type,sheet,row};
}
const STATS_STATE={page:1,pageSize:25,searchInputValue:"",debouncedSearchValue:"",sort:"absDesc",isFiltering:false,_normalizedRows:null,_debounceTimer:null,_idleTimer:null,_computeToken:0,_sourceHash:"",_lastRenderHash:"",_pendingRaf:0};
const STATS_CACHE_KEY="statsAccuracyCacheV1";

function getStatsSourceRows(){return [...(DATA["RPL"]||[]),...(DATA["BULKY"]||[])].filter(r=>clean(getVal(r,["sku"])));}
function getStatsSourceHash(rows){return `${rows.length}|${rows.map(r=>`${getVal(r,["sku"])}|${getVal(r,["lokasi"])}|${getVal(r,["selisih","selisih kartu stok","selisih kartu stock","selisih kartu stok vs iseller","selisih kartu stok vs netsuite"])}|${getVal(r,["nama barang","nama"])}|${getVal(r,["stok bulky"])}|${getVal(r,["stok retail"])}|${getVal(r,["stok global","kartu stok","stok kartu","stok kartu stok"])}|${getVal(r,["status"])}|${getVal(r,["ns dan iseller","iseller vs netsuite"])}`).join("~")}`;}
function getStatsCache(){try{const raw=localStorage.getItem(STATS_CACHE_KEY);if(!raw)return null;const parsed=JSON.parse(raw);return parsed&&Array.isArray(parsed.normalizedRows)?parsed:null;}catch(_){return null;}}
function saveStatsCache(payload){try{localStorage.setItem(STATS_CACHE_KEY,JSON.stringify(payload));}catch(_){}}
function computeStatsFromNormalized(normRows){const totalSku=normRows.length,skuAkurat=normRows.filter(r=>r.selisih===0).length,skuTidakAkurat=totalSku-skuAkurat,akurasi=totalSku?((skuAkurat/totalSku)*100):0,selisihTotal=normRows.reduce((n,r)=>n+r.selisih,0);return {totalSku,skuAkurat,skuTidakAkurat,akurasi,selisihTotal};}
function renderStatsSummaryFromComputed(summary){statsCards.innerHTML=[["Total SKU",summary.totalSku,""],["Akurat (%)",`${summary.akurasi.toFixed(2)}%`,"ok"],["Tidak Akurat",summary.skuTidakAkurat,"err"],["Selisih Total",summary.selisihTotal,"warn"]].map(c=>`<div class='metric ${c[2]||""}'><div class='k'>${c[0]}</div><div class='v'>${esc(c[1])}</div></div>`).join("");}
function hashNormalizedRows(rows){return JSON.stringify(rows.map(r=>[r.sku,r.nama,r.selisih,r.lokasiText]));}
function buildNormalizedStatsRowsAsync(sourceRows,token){return new Promise(resolve=>{const bySku=new Map();let i=0;const step=()=>{if(token!==STATS_STATE._computeToken)return resolve(null);const end=Math.min(i+400,sourceRows.length);for(;i<end;i++){const r=sourceRows[i];const sel=parseNumber(getVal(r,["selisih","selisih kartu stok","selisih kartu stock","selisih kartu stok vs iseller","selisih kartu stok vs netsuite"]));const lokasi=getVal(r,["lokasi"])||"-";const sku=getVal(r,["sku"])||"-";const nama=getVal(r,["nama barang","nama"])||"-";const key=clean(sku);if(!key)continue;if(!bySku.has(key))bySku.set(key,{sku,nama,lokasiSet:new Set(),selisih:0,selisihAbs:0});const it=bySku.get(key);if(it.nama==="-"&&nama!=="-")it.nama=nama;if(lokasi&&lokasi!=="-")it.lokasiSet.add(String(lokasi));it.selisih+=Number(sel)||0;it.selisihAbs=Math.abs(it.selisih);}if(i<sourceRows.length){setTimeout(step,0);return;}const aggregated=[...bySku.values()].map(r=>({...r,lokasi:[...r.lokasiSet],lokasiText:[...r.lokasiSet].length?[...r.lokasiSet].join(", "):"-",_searchText:clean(`${r.sku} ${r.nama} ${[...r.lokasiSet].join(", ")}`)}));resolve(aggregated);};setTimeout(step,0);});}
function renderStatsLayoutSkeleton(){statsChart.innerHTML=`<div class='mv-toolbar stats-toolbar'>
<label class='stats-search-field'><span>Cari SKU / Nama / Lokasi</span><input id='statsSearch' placeholder='Ketik kata kunci...' value='${esc(STATS_STATE.searchInputValue)}'></label>
<select id='statsSort' aria-label='Urutkan data'><option value='absDesc'>Selisih terbesar</option><option value='absAsc'>Selisih terkecil</option><option value='sku'>SKU A-Z</option></select>
<select id='statsSize' aria-label='Jumlah data per halaman'><option value='25'>25 / halaman</option><option value='50'>50 / halaman</option><option value='100'>100 / halaman</option></select><small id='statsFilterState' class='stats-filtering-indicator'>Memuat data...</small></div>
<div class='stats-table-shell'><div class='table-wrap table-wrap-full stats-table-wrap'><table><thead><tr><th>LOKASI</th><th>SKU</th><th>NAMA BARANG</th><th>SELISIH</th><th>AKSI</th></tr></thead><tbody id='statsTbody'><tr><td colspan='5'><div class='state'>Memuat akurasi stok...</div></td></tr></tbody></table></div></div>
<div class='mv-pagination stats-pagination'><span id='statsPagingText'>Menampilkan 0 dari 0 data</span><div class='row'><button class='btn-ghost' id='statsPrev'>Prev</button><button class='btn-ghost' id='statsNext'>Next</button></div></div>`;
document.getElementById("statsSearch")?.addEventListener("input",e=>{STATS_STATE.searchInputValue=e.target.value;clearTimeout(STATS_STATE._debounceTimer);STATS_STATE._debounceTimer=setTimeout(scheduleStatsFilter,350);renderStatsFilteringState();});
document.getElementById("statsSort")&&(document.getElementById("statsSort").value=STATS_STATE.sort);
document.getElementById("statsSize")&&(document.getElementById("statsSize").value=String(STATS_STATE.pageSize));
document.getElementById("statsSort")?.addEventListener("change",e=>{STATS_STATE.sort=e.target.value;updateStatsTableOnly();});
document.getElementById("statsSize")?.addEventListener("change",e=>{STATS_STATE.pageSize=Number(e.target.value)||25;STATS_STATE.page=1;updateStatsTableOnly();});
document.getElementById("statsPrev")?.addEventListener("click",()=>{STATS_STATE.page=Math.max(1,STATS_STATE.page-1);updateStatsTableOnly();});
document.getElementById("statsNext")?.addEventListener("click",()=>{const maxPage=Math.max(1,Math.ceil(getFilteredStatsRows().length/STATS_STATE.pageSize));STATS_STATE.page=Math.min(maxPage,STATS_STATE.page+1);updateStatsTableOnly();});}

function renderStatsFilteringState(){const el=document.getElementById("statsFilterState");if(el)el.textContent=STATS_STATE.isFiltering?"Memfilter...":"";}
function scheduleStatsFilter(){
  STATS_STATE.isFiltering=true;renderStatsFilteringState();
  if(STATS_STATE._idleTimer){clearTimeout(STATS_STATE._idleTimer);STATS_STATE._idleTimer=null;}
  const run=()=>{STATS_STATE._idleTimer=setTimeout(()=>{STATS_STATE.debouncedSearchValue=STATS_STATE.searchInputValue;STATS_STATE.page=1;STATS_STATE.isFiltering=false;updateStatsTableOnly();renderStatsFilteringState();},0);};
  if(typeof window.requestIdleCallback==="function")window.requestIdleCallback(run,{timeout:400});else run();
}
function getFilteredStatsRows(){
  const rows=STATS_STATE._normalizedRows||[];
  const q=clean(STATS_STATE.debouncedSearchValue||"");
  const sorter={absDesc:(a,b)=>b.selisihAbs-a.selisihAbs,absAsc:(a,b)=>a.selisihAbs-b.selisihAbs,sku:(a,b)=>a.sku.localeCompare(b.sku)};
  return [...rows.filter(r=>!q||r._searchText.includes(q))].sort(sorter[STATS_STATE.sort]||sorter.absDesc);
}
function updateStatsTableOnly(){
  const tableRows=getFilteredStatsRows();
  const maxPage=Math.max(1,Math.ceil(tableRows.length/STATS_STATE.pageSize));if(STATS_STATE.page>maxPage)STATS_STATE.page=maxPage;
  const paged=tableRows.slice((STATS_STATE.page-1)*STATS_STATE.pageSize,STATS_STATE.page*STATS_STATE.pageSize);
  const tbody=document.getElementById("statsTbody");const paging=document.getElementById("statsPagingText");
  if(tbody)tbody.innerHTML=paged.map(r=>`<tr class='${r.selisih!==0?"row-mismatch":""}'><td title='${encAttr(r.lokasiText)}'>${esc(r.lokasiText)}</td><td>${esc(r.sku)}</td><td><div class='nama-barang'>${esc(r.nama)}</div></td><td class='${r.selisih!==0?"txt-danger":""}'>${r.selisih}</td><td class='action-cell'><button class='detail-mini-btn' type='button' onclick="navigateToSku(decodeURIComponent('${encAttr(r.sku)}'))">Lihat SKU</button></td></tr>`).join("")||`<tr><td colspan='5'><div class='state'>Tidak ada data.</div></td></tr>`;
  if(paging)paging.textContent=`Menampilkan ${(tableRows.length?((STATS_STATE.page-1)*STATS_STATE.pageSize+1):0)}–${Math.min(STATS_STATE.page*STATS_STATE.pageSize,tableRows.length)} dari ${tableRows.length} data`;
}
function updateStats(){
const rows=getStatsSourceRows();
renderStatsLayoutSkeleton();
if(!rows.length){statsCards.innerHTML="";const tb=document.getElementById("statsTbody");if(tb)tb.innerHTML="<tr><td colspan='5'><div class='state'>Sheet RPL/BULKY belum ada data.</div></td></tr>";const pg=document.getElementById("statsPagingText");if(pg)pg.textContent="Menampilkan 0 dari 0 data";return;}
const sourceHash=getStatsSourceHash(rows);STATS_STATE._sourceHash=sourceHash;
const cache=getStatsCache();
if(cache&&cache.sourceHash===sourceHash){STATS_STATE._normalizedRows=cache.normalizedRows;renderStatsSummaryFromComputed(computeStatsFromNormalized(cache.normalizedRows));updateStatsTableOnly();renderStatsFilteringState();}
else if(cache&&Array.isArray(cache.normalizedRows)&&cache.normalizedRows.length){STATS_STATE._normalizedRows=cache.normalizedRows;renderStatsSummaryFromComputed(computeStatsFromNormalized(cache.normalizedRows));updateStatsTableOnly();const fs=document.getElementById("statsFilterState");if(fs)fs.textContent="Menampilkan cache, sinkronisasi data terbaru...";}
else{statsCards.innerHTML=[1,2,3,4].map(()=>"<div class='metric'><div class='k'>...</div><div class='v'>...</div></div>").join("");}
const token=++STATS_STATE._computeToken;
buildNormalizedStatsRowsAsync(rows,token).then(latest=>{if(!latest||token!==STATS_STATE._computeToken)return;const newHash=hashNormalizedRows(latest);if(newHash===STATS_STATE._lastRenderHash){const fs=document.getElementById("statsFilterState");if(fs)fs.textContent="";return;}STATS_STATE._normalizedRows=latest;STATS_STATE._lastRenderHash=newHash;renderStatsSummaryFromComputed(computeStatsFromNormalized(latest));updateStatsTableOnly();renderStatsFilteringState();saveStatsCache({sourceHash,normalizedRows:latest,cachedAt:Date.now()});});
}
function normalizeDateKey(raw){
  const s=String(raw||"").trim();
  if(!s)return "";
  const normalized=s.replace(/\./g,"/").replace(/-/g,"/");
  const m=normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(m){
    const d=Number(m[1]),mo=Number(m[2]);let y=Number(m[3]);if(y<100)y+=2000;
    if(d>=1&&d<=31&&mo>=1&&mo<=12)return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }
  const dt=new Date(s);if(Number.isNaN(dt.getTime()))return "";
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}
function updateSettings(){loadedState.textContent=apiConnected?"Loaded":"Belum loaded";countPerSheet.textContent=SHEETS.map(s=>`${s}: ${(DATA[s]||[]).length}`).join(" | ");updateSettingsDashboard();}
function formatSyncDate(ts){if(!ts)return "-";return new Date(ts).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"});}
function getSystemStatusMeta(){
  if(isSyncing)return {label:"Loading",dot:"loading"};
  if(!apiConnected)return {label:"Error",dot:"error"};
  return {label:"Normal",dot:"ok"};
}
function updateSettingsDashboard(){
  if(!settingsDataSources)return;
  const sheetMap={"Barang Masuk":"Barang Masuk","Barang Keluar":"Barang Keluar","Kartu Stock":"Kartu Stock","RPL":"RPL","BULKY":"BULKY","Dashboard Akurasi":"Kartu Stock"};
  const icons={"Barang Masuk":"arrow-down-to-line","Barang Keluar":"arrow-up-from-line","Kartu Stock":"package-search","RPL":"clipboard-list","BULKY":"boxes","Dashboard Akurasi":"shield-check"};
  const totalRows=Object.values(DATA).reduce((n,rows)=>n+(Array.isArray(rows)?rows.length:0),0);
  const lastTs=getLastSyncTs();
  const status=getSystemStatusMeta();
  settingsLastRefresh.textContent=formatSyncDate(lastTs);
  settingsTotalRows.textContent=`${totalRows.toLocaleString("id-ID")} row`;
  settingsSystemStatus.textContent=status.label;
  settingsSystemDot.className=`status-dot ${status.dot}`;
  settingsCacheStatus.textContent=lastTs?"Aktif":"Tidak aktif";
  settingsCacheTime.textContent=formatSyncDate(lastTs);
  settingsDataSources.innerHTML=Object.entries(sheetMap).map(([label,key])=>{
    const count=(DATA[key]||[]).length;
    const tag=!apiConnected?"error":(count>0?"ok":"empty");
    const txt=!apiConnected?"error":(count>0?"tersedia":"kosong");
    const active=!apiConnected?"Tidak ada data":(count>0?"Aktif":"Tidak ada data");
    return `<div class='settings-source-item'><div class='settings-source-main'><i data-lucide='${icons[label]||"database"}'></i><div><strong>${label}</strong><small>${active}</small></div></div><div class='settings-source-meta'><span>${count.toLocaleString("id-ID")} row</span><em class='${tag}'>${txt}</em></div></div>`;
  }).join("");
  if(window.lucide)lucide.createIcons();
}
function renderFilters(){const searchFilters=FILTERS.filter(f=>!["Barang Masuk","Barang Keluar"].includes(f));filterRow.innerHTML=searchFilters.map(f=>`<button class='chip ${f===currentFilter?"active":""}' onclick="setFilter(decodeURIComponent('${encAttr(f)}'))">${esc(f)}</button>`).join("");if(!searchFilters.includes(currentFilter)){currentFilter="Semua";}}
function setFilter(f){currentFilter=f;renderFilters();SEARCH_STATE.filterValue=SEARCH_STATE.inputValue||searchInput?.value||lastQuery||"";runSearch();}
function setMainContentLoading(isLoading){
if(mainContentSkeleton){mainContentSkeleton.classList.toggle("hidden",!isLoading);}
if(mainContentPages){mainContentPages.classList.toggle("hidden",!!isLoading);}
}
function initDashboard(){setMainContentLoading(true);}
function setStatus(type,text){statusEl.textContent=type==="loading"?`⏳ ${text}`:(type==="error"?`❌ ${text}`:text)}
function updateSyncUI(){
const refreshBtn=document.querySelector("[data-refresh-btn]");
const refreshing=!!(isSyncing||REFRESH_STATE.isRefreshing);
if(refreshBtn){refreshBtn.classList.toggle("is-syncing",refreshing);refreshBtn.disabled=refreshing;}
if(refreshToggleHeader){refreshToggleHeader.classList.toggle("is-syncing",refreshing);refreshToggleHeader.disabled=refreshing;}
}
function renderState(id,text){document.getElementById(id).innerHTML=`<div class='state'>${esc(text)}</div>`;} function renderError(id,text){document.getElementById(id).innerHTML=`<div class='state error'>${esc(text)}</div>`;}
function updateSyncTime(){renderInventorySyncStatus();updateSettingsDashboard();}
function updateApiState(){const t=apiConnected?"Terhubung":"Tidak terhubung";settingsApiState.textContent=t;sidebarApi.textContent="";updateSettingsDashboard();}
async function clearSystemCache(){
  showConfirmModal({title:'Hapus Cache',message:'Hapus cache lokal sekarang?',confirmText:'Hapus',cancelText:'Batal',type:'danger',onConfirm:async()=>{await clearCache();updateSettingsDashboard();toast("Cache berhasil dibersihkan","success");}});
}
function showCopyButtonFeedback(btn){if(!btn)return;const label=btn.querySelector('span:last-child');if(!label)return;const prev=label.textContent;btn.classList.add('is-copied');label.textContent='Copied';clearTimeout(btn._copyTimer);btn._copyTimer=setTimeout(()=>{label.textContent=prev;btn.classList.remove('is-copied');},1200);}
function copySku(sku,btn){navigator.clipboard.writeText(sku||"").then(()=>{showCopyButtonFeedback(btn);toast(`SKU ${sku} disalin`);});}
function copyText(value,message,btn){navigator.clipboard.writeText(value||"").then(()=>{showCopyButtonFeedback(btn);toast(message);});}
function applyTheme(){const saved=localStorage.getItem("theme");const theme=saved||"dark";document.documentElement.setAttribute("data-theme",theme);document.body.classList.toggle("dark",theme==="dark");syncThemeButton();syncRefreshButton();}
function toggleDark(){const nextTheme=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",nextTheme);document.body.classList.toggle("dark",nextTheme==="dark");localStorage.setItem("theme",nextTheme);syncThemeButton();}
function syncThemeButton(){if(!darkBtnHeader)return;const dark=document.documentElement.getAttribute("data-theme")==="dark";darkBtnHeader.innerHTML=`<i data-lucide="${dark?"sun":"moon-star"}"></i>`;if(window.lucide)lucide.createIcons();}

function captureActivePageScroll(page){
const root=document.getElementById(`page-${page}`),positions=[];
root?.querySelectorAll('.table-wrap,.table-scroll,[data-preserve-scroll]').forEach((element,index)=>positions.push({index,id:element.id||'',top:element.scrollTop,left:element.scrollLeft}));
return {windowX:window.scrollX,windowY:window.scrollY,positions};
}
async function restoreActivePageScroll(page,snapshot){
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
if(getActivePage()!==page)return;
const root=document.getElementById(`page-${page}`),scrollables=[...(root?.querySelectorAll('.table-wrap,.table-scroll,[data-preserve-scroll]')||[])];
snapshot.positions.forEach(position=>{const element=position.id?document.getElementById(position.id):scrollables[position.index];if(element){element.scrollTop=position.top;element.scrollLeft=position.left;}});
window.scrollTo(snapshot.windowX,snapshot.windowY);
}
async function refreshDashboard(){await loadDashboardPayload();}
async function refreshTransactionPage(mode){const source=transactionSource(mode);TRANSACTION_PAGE_CACHE.clearSource(source);TRANSACTION_PREFETCH_FAILED.clear();return loadTransactionTablePage(mode,{page:TABLE_STATE[mode].page,search:mode==='in'?inSearch?.value:outSearch?.value,force:true,background:true});}
function refreshBarangMasuk(){return refreshTransactionPage('in');}
function refreshBarangKeluar(){return refreshTransactionPage('out');}
async function refreshLokasi(){LOCATION_STATE.summary=null;LOCATION_STATE.pageCache.clear();LOCATION_STATE.detailCache.clear();await Promise.all([loadLocationSummary(),loadLocationPage(LOCATION_STATE.page),loadEmptyLocations(LOCATION_STATE.emptyPage)]);if(LOCATION_STATE.selected)await selectLocationDetail(encodeURIComponent(LOCATION_STATE.selected));}
async function refreshWarning(){return loadWarningPage({preserveScroll:true,throwOnError:true});}
async function refreshCycleCount(){delete MODULE_CACHE_MEMORY[MODULE_CACHE_KEYS.cycleCount];await loadCycleCountHistory({force:true});renderCycleCountPage();}
async function refreshMovement(){delete MODULE_CACHE_MEMORY[MODULE_CACHE_KEYS.movement];MOVEMENT_STATE.suggestionCache={key:'',rows:[],count:0};MOVEMENT_HISTORY_REMOTE.loaded=false;const results=await Promise.allSettled([refreshInventoryGroupFull(),ensureMovementHistoryLoaded(),refreshMovementTotal()]);const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;renderMovementPage();}
async function refreshBalikanStore(){delete MODULE_CACHE_MEMORY[MODULE_CACHE_KEYS.balikanStore];return loadBalikanRows({background:true,force:true,throwOnError:true});}
async function refreshSkuDetail(sku=currentSku){if(!sku)throw new Error('SKU tidak tersedia');return showDetail(sku,{background:true,throwOnError:true});}
async function refreshSearch(){if((SEARCH_STATE.inputValue||searchInput?.value||'').trim())await runSearch();}
async function refreshBarangReject(){const result=await loadBarangRejectData({force:true,background:true});if(!result)throw new Error('Gagal memuat Barang Reject');}
const SOFT_REFRESH_ROUTES={dashboard:refreshDashboard,'barang-masuk':refreshBarangMasuk,'barang-keluar':refreshBarangKeluar,locations:refreshLokasi,anomaly:refreshWarning,'cycle-count':refreshCycleCount,movement:refreshMovement,'balikan-store':refreshBalikanStore,detail:()=>refreshSkuDetail(currentSku),search:refreshSearch,'barang-reject':refreshBarangReject,'activity-log':renderActivityLogPage};
window.SOFT_REFRESH_ROUTES=SOFT_REFRESH_ROUTES;

async function triggerManualRefresh(){
if(REFRESH_STATE.refreshPromise)return REFRESH_STATE.refreshPromise;
const activePage=getActivePage?.()||'dashboard',scrollState=captureActivePageScroll(activePage);
const refresh=SOFT_REFRESH_ROUTES[activePage];
if(!refresh){toast('Refresh belum tersedia untuk halaman ini.','warning');return false;}
logActivitySafe({action:'MANUAL_REFRESH',module:activePage,detail:'Soft refresh dimulai',status:'SUCCESS'});
REFRESH_STATE.refreshPromise=(async()=>{
setRefreshIndicator(true,'Refreshing...');
try{
await refresh();
await restoreActivePageScroll(activePage,scrollState);
setStatus('ok','Data berhasil diperbarui');
toast('Data berhasil diperbarui','success');
if(manualRefreshNoticeTimer)clearTimeout(manualRefreshNoticeTimer);
manualRefreshNoticeTimer=setTimeout(()=>setStatus('ok',''),1800);
return true;
}catch(error){
console.error(`[SoftRefresh:${activePage}]`,error);
await restoreActivePageScroll(activePage,scrollState);
setStatus('error','Gagal memperbarui data.');
toast('Gagal memperbarui data.','error');
return false;
}finally{
setRefreshIndicator(false);
REFRESH_STATE.refreshPromise=null;
}
})();
return REFRESH_STATE.refreshPromise;
}
function syncRefreshButton(){if(!refreshToggleHeader)return;refreshToggleHeader.innerHTML=`<i data-lucide="refresh-cw"></i>`;refreshToggleHeader.title="Refresh data manual";refreshToggleHeader.setAttribute("aria-label","Refresh data manual");if(window.lucide)lucide.createIcons();}
function getDevAutoRefreshEls(){
return {
interval:document.getElementById("devAutoRefreshInterval"),
status:document.getElementById("devAutoRefreshStatus"),
lastTime:document.getElementById("devAutoRefreshLastTime"),
count:document.getElementById("devAutoRefreshCountValue"),
lastError:document.getElementById("devAutoRefreshLastError"),
start:document.getElementById("devAutoRefreshStart"),
stop:document.getElementById("devAutoRefreshStop")
};
}
function isDevAutoRefreshElement(el){return !!el&&typeof el==="object"&&"textContent" in el;}
function getDevAutoRefreshIntervalMs(){
const {interval}=getDevAutoRefreshEls();
const raw=Number(interval?.value)||30;
const seconds=Math.max(5,raw);
if(interval&&String(seconds)!==String(raw))interval.value=String(seconds);
return seconds*1000;
}
function formatDevAutoRefreshTime(ts){return ts?new Date(ts).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"medium"}):"-";}
function syncDevAutoRefreshGlobals(){
window.isDevAutoRefreshRunning=isDevAutoRefreshRunning;
window.isDevAutoRefreshingNow=isDevAutoRefreshingNow;
window.devAutoRefreshTimer=devAutoRefreshTimer;
window.devAutoRefreshCount=devAutoRefreshCount;
}
function renderToolsDevPage(){
const els=getDevAutoRefreshEls();
if(!isDevAutoRefreshElement(els.status)){syncDevAutoRefreshGlobals();return;}
const allowed=isToolsDevAllowed();
const status=isDevAutoRefreshRunning?(isDevAutoRefreshingNow?"Running - refreshing":"Running"):"Stopped";
els.status.textContent=allowed?status:"Restricted";
if(isDevAutoRefreshElement(els.lastTime))els.lastTime.textContent=formatDevAutoRefreshTime(devAutoRefreshLastTs);
if(isDevAutoRefreshElement(els.count))els.count.textContent=String(devAutoRefreshCount);
if(isDevAutoRefreshElement(els.lastError))els.lastError.textContent=devAutoRefreshLastError||"-";
if(els.start)els.start.disabled=!allowed||isDevAutoRefreshRunning;
if(els.stop)els.stop.disabled=!allowed||(!isDevAutoRefreshRunning&&!devAutoRefreshTimer&&!isDevAutoRefreshingNow);
if(els.interval)els.interval.disabled=!allowed||isDevAutoRefreshRunning;
syncDevAutoRefreshGlobals();
}
function scheduleDevAutoRefreshNext(){
if(!isDevAutoRefreshRunning)return;
if(devAutoRefreshTimer)clearTimeout(devAutoRefreshTimer);
devAutoRefreshTimer=setTimeout(()=>{devAutoRefreshTimer=null;runDevAutoRefreshCycle();},getDevAutoRefreshIntervalMs());
syncDevAutoRefreshGlobals();
}
async function runDevAutoRefreshCycle(){
if(!isDevAutoRefreshRunning||isDevAutoRefreshingNow)return;
isDevAutoRefreshingNow=true;
renderToolsDevPage();
try{
const refreshed=await syncData({force:true,silent:true});
if(refreshed!==false){
devAutoRefreshLastError="";
devAutoRefreshCount+=1;
devAutoRefreshLastTs=Date.now();
logActivitySafe({action:'DEV_AUTO_REFRESH_TICK',module:'Tools Dev',detail:`Auto refresh #${devAutoRefreshCount} selesai`,status:'SUCCESS',metadata:{count:devAutoRefreshCount,intervalMs:getDevAutoRefreshIntervalMs()}});
}else{
logActivitySafe({action:'DEV_AUTO_REFRESH_SKIP',module:'Tools Dev',detail:'Auto refresh dilewati karena proses sync lain masih berjalan',status:'SUCCESS',metadata:{count:devAutoRefreshCount,intervalMs:getDevAutoRefreshIntervalMs()}});
}
}catch(err){
devAutoRefreshLastError=err?.message||String(err||"Gagal auto refresh");
logActivitySafe({action:'DEV_AUTO_REFRESH_TICK',module:'Tools Dev',detail:devAutoRefreshLastError,status:'FAILED',metadata:{count:devAutoRefreshCount+1,intervalMs:getDevAutoRefreshIntervalMs()}});
}finally{
isDevAutoRefreshingNow=false;
renderToolsDevPage();
scheduleDevAutoRefreshNext();
}
}
function startDevAutoRefresh(){
if(!isToolsDevAllowed()){toast('Tools Dev hanya untuk preview/development/admin','error');return;}
if(isDevAutoRefreshRunning)return;
isDevAutoRefreshRunning=true;
devAutoRefreshLastError="";
if(devAutoRefreshTimer){clearTimeout(devAutoRefreshTimer);devAutoRefreshTimer=null;}
logActivitySafe({action:'DEV_AUTO_REFRESH_START',module:'Tools Dev',detail:`Auto refresh dimulai interval ${getDevAutoRefreshIntervalMs()/1000} detik`,status:'SUCCESS'});
renderToolsDevPage();
runDevAutoRefreshCycle();
}
function stopDevAutoRefresh({log=true}={}){
if(devAutoRefreshTimer){clearTimeout(devAutoRefreshTimer);devAutoRefreshTimer=null;}
const wasRunning=isDevAutoRefreshRunning||isDevAutoRefreshingNow;
isDevAutoRefreshRunning=false;
if(log&&wasRunning)logActivitySafe({action:'DEV_AUTO_REFRESH_STOP',module:'Tools Dev',detail:`Auto refresh dihentikan setelah ${devAutoRefreshCount} refresh`,status:'SUCCESS'});
renderToolsDevPage();
}
function bindDevAutoRefreshControls(){
const els=getDevAutoRefreshEls();
if(els.start&&!els.start.dataset.devAutoRefreshBound){els.start.addEventListener('click',startDevAutoRefresh);els.start.dataset.devAutoRefreshBound="1";}
if(els.stop&&!els.stop.dataset.devAutoRefreshBound){els.stop.addEventListener('click',()=>stopDevAutoRefresh());els.stop.dataset.devAutoRefreshBound="1";}
if(els.interval&&!els.interval.dataset.devAutoRefreshBound){els.interval.addEventListener('input',renderToolsDevPage);els.interval.dataset.devAutoRefreshBound="1";}
renderToolsDevPage();
}

function hideInitialLoader(){const ld=document.getElementById("initialLoader");if(ld)ld.remove();}
function toggleCompact(){document.body.classList.toggle("compact");toast("Compact mode diubah");}
function toast(msg,type="info",showClose=true){const t=document.getElementById("toast");if(!t)return;const map={success:"✓",error:"⨯",warning:"!",info:"i"};const item=document.createElement("div");item.className=`toast-item ${map[type]?type:"info"}`;const closeBtn=showClose?'<button class="toast-close" aria-label="Tutup" type="button">×</button>':"";item.innerHTML=`<span class="toast-icon" aria-hidden="true">${map[type]||map.info}</span><span class="toast-message">${esc(msg||"")}</span>${closeBtn}`;t.appendChild(item);requestAnimationFrame(()=>item.classList.add("show"));const remove=()=>{item.classList.remove("show");setTimeout(()=>item.remove(),220);};item.querySelector(".toast-close")?.addEventListener("click",remove);setTimeout(remove,2500);}

function showConfirmModal({title='Konfirmasi',message='',confirmText='Ya',cancelText='Batal',type='default',allowHtmlMessage=false,onConfirm}={}){
  const root=document.getElementById('confirmModalRoot');
  if(!root){if(typeof onConfirm==='function')onConfirm();return;}
  const confirmClass=type==='danger'?'btn-primary confirm-modal-confirm danger':'btn-primary confirm-modal-confirm';
  root.innerHTML=`<div class='confirm-modal' role='dialog' aria-modal='true' aria-labelledby='confirmModalTitle'><div class='confirm-modal-card'><div class='confirm-modal-head'><div class='confirm-modal-badge' aria-hidden='true'>${type==='danger'?'!':'?'}</div><h4 id='confirmModalTitle' class='confirm-modal-title'>${esc(title)}</h4></div><div class='confirm-modal-message' data-confirm-message></div><div class='confirm-modal-actions'><button type='button' class='btn-ghost' data-confirm-cancel>${esc(cancelText)}</button><button type='button' class='${confirmClass}' data-confirm-ok>${esc(confirmText)}</button></div></div></div>`;
  const messageEl=root.querySelector('[data-confirm-message]');
  if(messageEl){if(allowHtmlMessage)messageEl.innerHTML=String(message||'');else messageEl.textContent=String(message||'');}
  root.classList.add('show');
  root.setAttribute('aria-hidden','false');
  const close=()=>{root.classList.remove('show');root.setAttribute('aria-hidden','true');root.innerHTML='';document.removeEventListener('keydown',onKeydown);};
  const onKeydown=(ev)=>{if(ev.key==='Escape')close();};
  root.querySelector('[data-confirm-cancel]')?.addEventListener('click',close);
  root.querySelector('[data-confirm-ok]')?.addEventListener('click',()=>{close();if(typeof onConfirm==='function')onConfirm();});
  root.querySelector('.confirm-modal')?.addEventListener('click',ev=>{if(ev.target===ev.currentTarget)close();});
  document.addEventListener('keydown',onKeydown);
}
function normalizeLookupKey(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function getVal(row,keys){if(Array.isArray(row)){const indexByKey={tanggal:0,date:0,from:1,to:2,sku:3,"nama barang":4,namabarang:4,nama:4,item:4,description:4,qty:5,status:6,pic:7,keterangan:8,notes:8,remark:8};for(const key of keys){const idx=indexByKey[clean(key)]??indexByKey[normalizeLookupKey(key)];if(Number.isInteger(idx)&&row[idx]!=null)return String(row[idx]);}return "";}const cols=Object.keys(row||{});for(const key of keys){const keyClean=clean(key),keyLookup=normalizeLookupKey(key);const f=cols.find(c=>{const colClean=clean(c),colLookup=normalizeLookupKey(c);return colClean===keyClean||colLookup===keyLookup||colClean.includes(keyClean)||colLookup.includes(keyLookup);});if(f&&row[f]!=null)return String(row[f]);}return "";}
function escapeRegExp(value){return String(value||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
function highlightText(text,keyword){
const raw=String(text??"");
const q=String(keyword??"").trim();
if(!q) return [document.createTextNode(raw)];
const safeKeyword=escapeRegExp(q);
if(!safeKeyword) return [document.createTextNode(raw)];
const regex=new RegExp(`(${safeKeyword})`,"ig");
const exactRegex=new RegExp(`^${safeKeyword}$`,"i");
return raw.split(regex).filter(part=>part!=="").map((part,index)=>{if(exactRegex.test(part)){const mark=document.createElement("mark");mark.className="search-highlight";mark.textContent=part;return mark;}return document.createTextNode(part);});
}
function highlight(text,query){const raw=String(text||"");const q=String(query||"").trim();if(!q) return esc(raw);const words=normalizeSearch(q).split(" ").filter(Boolean).slice(0,6);let out=esc(raw);words.forEach(w=>{const e=escapeRegExp(w);out=out.replace(new RegExp(`(${e})`,"ig"),"<mark>$1</mark>")});return out;}
function normalizeSearch(value){return String(value||"").toLowerCase().trim().replace(/\s+/g," ");}
function normalizeHeader(v){return clean(v).replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();} function clean(v){return String(v||"").toLowerCase().trim().replace(/[_-]+/g," ").replace(/\s+/g," ");}
function parseNumber(v){const n=parseFloat(String(v||"").replace(/[^0-9.-]/g,""));return Number.isFinite(n)?n:0;} function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));}
function encAttr(v){return encodeURIComponent(String(v??""));} function badgeClass(s){return s==="Kartu Stock"?"b-kartu":s==="RPL"?"b-rpl":s==="BULKY"?"b-bulky":s==="Barang Masuk"?"b-in":"b-out";}
function debounce(fn,wait){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait)}}


const TRANSACTION_PAGE_CACHE=new TransactionPageCache(8);
const TRANSACTION_PREFETCH_IN_FLIGHT=new Set();
const TRANSACTION_PREFETCH_FAILED=new Set();
function transactionSource(mode){return mode==='in'?'barang_masuk':'barang_keluar';}
function transactionFilters(mode){return TABLE_STATE[mode]?.columnFilters||{};}
function applyTransactionPayload(mode,payload,{page,limit}={}){const st=TABLE_STATE[mode],rows=normalizeBackendRows(payload);st.page=Number(payload.page)||page;st.pageSize=Number(payload.limit)||limit;st.total=Number(payload.total)||0;st.summary=payload.summary||st.summary||{totalRows:st.total,totalQty:0,totalSku:0};window.APP_STATE=window.APP_STATE||{};if(mode==='in'){window.APP_STATE.barangMasuk=rows;DATA['Barang Masuk']=rows;}else{window.APP_STATE.barangKeluar=rows;DATA['Barang Keluar']=rows;}return rows;}
async function prefetchTransactionPage(mode,{page,limit,query,sort,filters,summaryKey}){const st=TABLE_STATE[mode];if(page<1||page>Math.ceil(st.total/limit))return;const source=transactionSource(mode),key=transactionPageKey({source,page,limit,query,filters,sort});if(TRANSACTION_PAGE_CACHE.get(source,key)||TRANSACTION_PREFETCH_IN_FLIGHT.has(key)||TRANSACTION_PREFETCH_FAILED.has(key))return;TRANSACTION_PREFETCH_IN_FLIGHT.add(key);const params=new URLSearchParams({page:String(page),limit:String(limit),sort,includeSummary:'0'});if(query)params.set('q',query);const endpoint=mode==='in'?'/api/barang-masuk':'/api/barang-keluar';try{const {res,data}=await fetchJsonSafe(`${endpoint}?${params}`);if(res.ok&&data?.success)TRANSACTION_PAGE_CACHE.set(source,key,{rows:normalizeBackendRows(data),total:Number(data.total)||0,summary:TRANSACTION_PAGE_CACHE.getSummary(summaryKey)?.summary||null,fetchedAt:Date.now()});else{TRANSACTION_PREFETCH_FAILED.add(key);console.debug(`[${source}] adjacent prefetch stopped`,{status:res.status,reason:data?.reason,code:data?.code});}}catch(err){TRANSACTION_PREFETCH_FAILED.add(key);console.debug(`[${source}] adjacent prefetch stopped`,err?.message||err);}finally{TRANSACTION_PREFETCH_IN_FLIGHT.delete(key);}}
async function loadTransactionTablePage(mode,{page,limit,search,force=false,background=false}={}){
const st=TABLE_STATE[mode],requestId=++st.requestId;st.abortController?.abort();const controller=new AbortController();st.abortController=controller;st.error="";
const nextPage=Math.max(1,Number(page)||st.page||1),nextLimit=[25,50].includes(Number(limit))?Number(limit):st.pageSize;
st.page=nextPage;st.pageSize=nextLimit;
const q=normalizeSearch(search??(mode==='in'?inSearch?.value:outSearch?.value)??'');
const sort=st.sort||'latest';
const source=transactionSource(mode),filters=transactionFilters(mode);const key=transactionPageKey({source,page:nextPage,limit:nextLimit,query:q,filters,sort});const summaryKey=transactionSummaryKey({source,query:q,filters});const cached=!force&&TRANSACTION_PAGE_CACHE.get(source,key);const cachedSummary=TRANSACTION_PAGE_CACHE.getSummary(summaryKey);
if(cached){applyTransactionPayload(mode,{...cached,summary:cached.summary||cachedSummary?.summary},{page:nextPage,limit:nextLimit});st.loading=false;renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);if(TRANSACTION_PAGE_CACHE.isFresh(cached,Date.now(),INVENTORY_VERSION_STATE.versions?.[mode==='in'?'barangMasukVersion':'barangKeluarVersion'])){st.abortController=null;queueMicrotask(()=>prefetchTransactionPage(mode,{page:nextPage+1,limit:nextLimit,query:q,sort,filters,summaryKey}));return cached.rows;}}
st.loading=!cached&&!background;
const params=new URLSearchParams({page:String(nextPage),limit:String(nextLimit),sort,includeSummary:String(!cachedSummary)});if(q)params.set('q',q);
const endpoint=mode==='in'?'/api/barang-masuk':'/api/barang-keluar';
if(!cached&&!background)renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);
try{const {res,data}=await fetchJsonSafe(`${endpoint}?${params}`,{signal:controller.signal,cache:force?'no-store':'default'});if(!res.ok||!data?.success){console.error(`[${source}] page request failed`,{status:res.status,reason:data?.reason,code:data?.code,message:data?.message});throw new Error(data?.message||'Gagal memuat data');}if(requestId!==st.requestId||controller.signal.aborted)return;TRANSACTION_PREFETCH_FAILED.delete(key);
if(data.summary)TRANSACTION_PAGE_CACHE.setSummary(summaryKey,data.summary);const summary=data.summary||cachedSummary?.summary||cached?.summary||{totalRows:Number(data.total)||0,totalQty:0,totalSku:0};const rows=applyTransactionPayload(mode,{...data,summary},{page:nextPage,limit:nextLimit});TRANSACTION_PAGE_CACHE.set(source,key,{rows,total:st.total,summary,fetchedAt:Date.now()});queueMicrotask(()=>prefetchTransactionPage(mode,{page:nextPage+1,limit:nextLimit,query:q,sort,filters,summaryKey}));return rows;
}catch(err){if(requestId!==st.requestId||controller.signal.aborted||err?.name==='AbortError')return;st.error=err?.message||'Gagal memuat data';throw err;
}finally{if(requestId===st.requestId){st.loading=false;st.abortController=null;if(background)rerenderTableWithScrollRestore(mode,true);else renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',true);}}
}
function invalidateInactiveTransactionRequests(page){for(const [mode,st] of Object.entries(TABLE_STATE)){const active=(page==='barang-masuk'&&mode==='in')||(page==='barang-keluar'&&mode==='out');if(active)continue;st.abortController?.abort();st.abortController=null;st.requestId++;st.loading=false;}}
const TRANSACTION_PRESENTATION_COLUMNS=["tanggal","from","to","sku","namaBarang","qty","status","pic","keterangan"];
const BARANG_MASUK_PRESENTATION_COLUMNS=[...TRANSACTION_PRESENTATION_COLUMNS,"no_iseller","netsuite","keterangan_lainnya","lokasi_surat_jalan","stockout","dokumen"];
const BARANG_KELUAR_PRESENTATION_COLUMNS=[...TRANSACTION_PRESENTATION_COLUMNS,"no_iseller","netsuite","keterangan_lainnya","status_lanjutan","lokasi_surat_jalan","no_iseller_awal","dokumen"];
const TRANSACTION_COLUMN_LABELS={tanggal:"TANGGAL",from:"FROM",to:"TO",sku:"SKU",namaBarang:"NAMA BARANG",qty:"QTY",status:"STATUS",pic:"PIC",keterangan:"KETERANGAN",no_iseller:"NO ISELLER",netsuite:"NETSUITE",keterangan_lainnya:"KETERANGAN LAINNYA",status_lanjutan:"STATUS LANJUTAN",lokasi_surat_jalan:"LOKASI SURAT JALAN",no_iseller_awal:"NO ISELLER AWAL",stockout:"STOCKOUT",dokumen:"DOKUMEN"};
function getTransactionPresentationCells(row,sheet="Barang Keluar"){const columns=sheet==="Barang Masuk"?BARANG_MASUK_PRESENTATION_COLUMNS:BARANG_KELUAR_PRESENTATION_COLUMNS;return Object.fromEntries(columns.map(key=>[key,row?.[key]??""]));}
function normalizeMovementRows(sheet,type){const baseRows=sheet==="Barang Masuk"?getBarangMasukRows():sheet==="Barang Keluar"?getBarangKeluarRows():(DATA[sheet]||[]);const scopedRows=(sheet==="Barang Masuk")?debugBarangMasukRows(baseRows,"Halaman Barang Masuk",isBarangMasukTableRow):baseRows;return scopedRows.map((r,sourceIndex)=>{const rawCells=getTransactionPresentationCells(r,sheet);const qty=parseNumber(getVal(r,["qty"]));return {...r,_rawCells:rawCells,_allColumns:Object.keys(rawCells),_searchText:clean(Object.values(rawCells).join(" ")),_type:type,_sheetOrder:sourceIndex,_qty:Number.isFinite(qty)?qty:0};});}
const DEBOUNCED_RENDER={in:debounce(()=>loadTransactionTablePage("in",{page:1,limit:document.getElementById("mv-size-in")?.value}),250),out:debounce(()=>loadTransactionTablePage("out",{page:1,limit:document.getElementById("mv-size-out")?.value}),250)};
function debouncedTableRender(mode){return (DEBOUNCED_RENDER[mode]||(()=>{}))();}
const selectedBarangMasukRows=new Set();
const selectedBarangKeluarRows=new Set();
function getSelectedSet(mode){return mode==="in"?selectedBarangMasukRows:selectedBarangKeluarRows;}
const TABLE_STATE={in:{page:1,pageSize:25,rows:[],filtered:[],openFilterCol:"",selected:selectedBarangMasukRows,deletingRows:new Set(),bulkDeleting:false,total:0,summary:{totalRows:0,totalQty:0,totalSku:0},loading:false,error:"",requestId:0,abortController:null,sort:"latest",cache:{rawHash:"",filterHash:"",sort:"latest",search:"",columnFilterHash:"",filteredRows:[]}},out:{page:1,pageSize:25,rows:[],filtered:[],openFilterCol:"",selected:selectedBarangKeluarRows,deletingRows:new Set(),bulkDeleting:false,total:0,summary:{totalRows:0,totalQty:0,totalSku:0},loading:false,error:"",requestId:0,abortController:null,sort:"latest",cache:{rawHash:"",filterHash:"",sort:"latest",search:"",columnFilterHash:"",filteredRows:[]}}};
const FILTERABLE_COLUMNS=[];
const FILTER_LABELS={};
const EMPTY_FILTER_VALUE="__WMS_EMPTY_VALUE__";
function isEmptyFilterValue(value){return value==null||String(value).trim()==="";}
function sanitizeFilterValue(value){return isEmptyFilterValue(value)?EMPTY_FILTER_VALUE:String(value).trim();}
function getFilterOptionLabel(value){return value===EMPTY_FILTER_VALUE?"(Kosong)":value;}
function getFilterRowValue(row,key,mode=""){if(mode==="balikan"&&key==="sheetName")return getBalikanActiveSheetName(row);return row?.[key];}
function getUniqueOptions(rows,key,mode=""){const values=[...new Set((rows||[]).map(row=>sanitizeFilterValue(getFilterRowValue(row,key,mode))))];const nonEmpty=values.filter(value=>value!==EMPTY_FILTER_VALUE).sort((a,b)=>a.localeCompare(b,"id",{numeric:true}));return [EMPTY_FILTER_VALUE,...nonEmpty];}
function renderColumnFilterOptions(options,selected){return options.map(value=>`<label data-opt-item><input type='checkbox' value='${esc(value)}' ${selected.includes(value)?'checked':''}> <span>${esc(getFilterOptionLabel(value))}</span></label>`).join('');}
function ensureColumnFilterState(mode){if(mode==='balikan')return ensureBalikanFilterState().columnFilters;const st=TABLE_STATE[mode];if(!st)return{};if(!st.columnFilters)st.columnFilters={};FILTERABLE_COLUMNS.forEach(k=>{if(!Array.isArray(st.columnFilters[k]))st.columnFilters[k]=[];});return st.columnFilters;}
function ensureMovementFilterColumns(columns){FILTERABLE_COLUMNS.length=0;columns.forEach(c=>{FILTER_LABELS[c]=TRANSACTION_COLUMN_LABELS[c]||String(c).toUpperCase();});}
function getMovementColumns(rows=[],mode="out"){return rows[0]?Object.keys(rows[0]._rawCells||{}):[...(mode==="in"?BARANG_MASUK_PRESENTATION_COLUMNS:BARANG_KELUAR_PRESENTATION_COLUMNS)];}
function getMovementRowsHash(rows){if(!Array.isArray(rows)||!rows.length)return "0";const first=rows[0],last=rows[rows.length-1];return `${rows.length}|${first?.rowNumber||""}|${last?.rowNumber||""}|${first?._sheetOrder||""}|${last?._sheetOrder||""}`;}
function getColumnFilterHash(filters){return FILTERABLE_COLUMNS.map(c=>`${c}:${(filters?.[c]||[]).join("|")}`).join("||");}
function getMovementFilteredRows(mode,sheetName){
const st=TABLE_STATE[mode];
const isIn=mode==="in";
const nextRows=normalizeMovementRows(sheetName,isIn?"IN":"OUT").map((r,i)=>({...r,rowNumber:Number(r.rowNumber)||i+2}));
const nextHash=getMovementRowsHash(nextRows);
if(st.cache.rawHash!==nextHash){st.rows=nextRows;st.cache.rawHash=nextHash;st.cache.filteredRows=[];}
const search=clean((isIn?inSearch:outSearch)?.value||"");
const columnFilters=ensureColumnFilterState(mode);
const columnFilterHash=getColumnFilterHash(columnFilters);
const sort=st.sort||"latest";
const filterHash=`${st.cache.rawHash}|${search}|${columnFilterHash}|${sort}`;
if(st.cache.filterHash!==filterHash){
const filtered=applyTableFilters(st.rows,mode);
st.cache.filteredRows=filtered;
st.cache.filterHash=filterHash;
}
return st.cache.filteredRows;
}
function rerenderTableByMode(mode,keepPage=true){if(mode==='in'||mode==='out')return renderDataTablePage(mode,mode==='in'?'Barang Masuk':'Barang Keluar',keepPage);if(mode==='balikan')return renderBalikanTable(keepPage);}
function rerenderTableWithScrollRestore(mode,keepPage=true){
  const isBalikan=mode==='balikan';
  const wrapSelector=isBalikan?'.balikan-table-wrapper':`#${mode==='in'?'inResults':'outResults'} .table-wrap`;
  const prevWrapper=document.querySelector(wrapSelector);
  const prevScrollTop=prevWrapper?.scrollTop||0;
  const prevScrollLeft=prevWrapper?.scrollLeft||0;
  rerenderTableByMode(mode,keepPage);
  requestAnimationFrame(()=>{
    const nextWrapper=document.querySelector(wrapSelector);
    if(!nextWrapper)return;
    const maxTop=Math.max(0,nextWrapper.scrollHeight-nextWrapper.clientHeight);
    const maxLeft=Math.max(0,nextWrapper.scrollWidth-nextWrapper.clientWidth);
    nextWrapper.scrollTop=Math.min(prevScrollTop,maxTop);
    nextWrapper.scrollLeft=Math.min(prevScrollLeft,maxLeft);
  });
}
function applyTableFilters(rows,mode,omitCol=""){const q=clean((mode==="in"?inSearch:outSearch)?.value||"");const columnFilters=ensureColumnFilterState(mode);return rows.filter(r=>{if(FILTERABLE_COLUMNS.some(col=>{if(col===omitCol)return false;const selected=columnFilters[col]||[];if(!selected.length)return false;return !selected.includes(sanitizeFilterValue(r?._rawCells?.[col]));}))return false;if(q&&!String(r?._searchText||"").includes(q))return false;return true;});}
function positionColumnFilterMenu(menu){
  if(!menu)return;
  const anchor=menu.closest(".th-filter-wrap")?.querySelector("[data-col-filter-toggle]");
  if(!anchor)return;
  menu.style.right="auto";menu.style.bottom="auto";
  const margin=8,gap=6;
  const a=anchor.getBoundingClientRect();
  const prevHidden=menu.hidden;
  if(prevHidden){menu.hidden=false;}
  const m=menu.getBoundingClientRect();
  const width=Math.min(m.width,window.innerWidth-(margin*2));
  const height=m.height;
  let left=a.left;
  if(left+width>window.innerWidth-margin){left=window.innerWidth-width-margin;}
  left=Math.max(margin,left);
  const spaceBelow=window.innerHeight-a.bottom-gap;
  const spaceAbove=a.top-gap;
  const openUp=spaceBelow<height&&spaceAbove>spaceBelow;
  let top=openUp?Math.max(margin,a.top-height-gap):Math.min(a.bottom+gap,window.innerHeight-height-margin);
  top=Math.max(margin,top);
  menu.style.left=`${left}px`;
  menu.style.top=`${top}px`;
  if(prevHidden){menu.hidden=true;}
}
function sortTableRows(rows,sort){const m={latest:(a,b)=>(a._sheetOrder??0)-(b._sheetOrder??0),oldest:(a,b)=>(a._sheetOrder??0)-(b._sheetOrder??0),sku:(a,b)=>String(getVal(a,["sku"])||"").localeCompare(String(getVal(b,["sku"])||"")),name:(a,b)=>String(getVal(a,["nama barang","namabarang","namaBarang","nama","item","description"])||"").localeCompare(String(getVal(b,["nama barang","namabarang","namaBarang","nama","item","description"])||"")),qtyDesc:(a,b)=>(b._qty||0)-(a._qty||0),qtyAsc:(a,b)=>(a._qty||0)-(b._qty||0)};return [...rows].sort(m[sort]||m.latest);}
function paginateRows(mode,action){const st=TABLE_STATE[mode];const max=Math.max(1,Math.ceil(st.total/st.pageSize));const page=action==="prev"?Math.max(1,st.page-1):Math.min(max,st.page+1);return loadTransactionTablePage(mode,{page});}
function toggleColumnVisibility(mode){const root=document.getElementById(`mv-cols-${mode}`);const cols=[...root.querySelectorAll('input[type="checkbox"]')].filter(c=>c.checked).map(c=>c.value);renderDataTablePage(mode,mode==="in"?"Barang Masuk":"Barang Keluar",true,cols);}
function closeColumnMenus(){document.querySelectorAll(".mv-columns.open").forEach(el=>el.classList.remove("open"));Object.keys(TABLE_STATE).forEach(k=>TABLE_STATE[k].columnMenuOpen=false);}
function positionColumnMenu(mode){
  const panel=document.getElementById(`mv-cols-${mode}`);if(!panel)return;
  const wrap=panel.closest(".mv-column-dropdown-wrap");if(!wrap)return;
  panel.classList.remove("align-right");
  const rect=panel.getBoundingClientRect();
  if(rect.right>window.innerWidth-8)panel.classList.add("align-right");
}
function toggleColumnMenu(mode){const target=document.getElementById(`mv-cols-${mode}`);if(!target)return;const willOpen=!target.classList.contains("open");closeColumnMenus();if(willOpen){target.classList.add("open");TABLE_STATE[mode].columnMenuOpen=true;positionColumnMenu(mode);}}
function toggleAllColumns(mode,checked){const root=document.getElementById(`mv-cols-${mode}`);if(!root)return;root.querySelectorAll('input[type="checkbox"]').forEach(c=>{c.checked=!!checked;});toggleColumnVisibility(mode);}
function exportFilteredCsv(mode){const st=TABLE_STATE[mode];const cols=st.columns||[];const lines=[cols.join(","),...st.filtered.map(r=>cols.map(c=>`"${String(r?._rawCells?.[c]??"").replaceAll('"','""')}"`).join(","))];const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8;"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=mode==="in"?"barang-masuk-filtered.csv":"barang-keluar-filtered.csv";a.click();URL.revokeObjectURL(a.href);} 
function renderTransactionLoadingState(mode,resultEl){const st=TABLE_STATE[mode];const columns=st.columns?.length?st.columns:(mode==="in"?BARANG_MASUK_PRESENTATION_COLUMNS:BARANG_KELUAR_PRESENTATION_COLUMNS);const toolbar=`<div class='mv-toolbar'><button class='btn-ghost' data-mv-action='reset' data-mv-mode='${mode}'>Reset Filter</button><select id='mv-sort-${mode}' data-mv-filter data-mv-mode='${mode}'><option value='latest' ${st.sort==='latest'?'selected':''}>Terbaru</option><option value='oldest' ${st.sort==='oldest'?'selected':''}>Terlama</option><option value='sku-asc' ${st.sort==='sku-asc'?'selected':''}>SKU A-Z</option><option value='name-asc' ${st.sort==='name-asc'?'selected':''}>Nama A-Z</option><option value='qty-desc' ${st.sort==='qty-desc'?'selected':''}>Qty terbesar</option><option value='qty-asc' ${st.sort==='qty-asc'?'selected':''}>Qty terkecil</option></select><select id='mv-size-${mode}' data-mv-filter data-mv-mode='${mode}'><option value='25' ${st.pageSize===25?'selected':''}>25</option><option value='50' ${st.pageSize===50?'selected':''}>50</option></select></div>`;const colspan=columns.length+2;const body=st.error?`<tr><td colspan='${colspan}'><div class='state error transaction-table-error'>Gagal memuat data<button class='btn-ghost' type='button' data-mv-action='retry' data-mv-mode='${mode}'>Coba Lagi</button></div></td></tr>`:Array.from({length:8},()=>`<tr class='mv-skeleton-row' aria-hidden='true'><td><span class='mv-skeleton-cell short'></span></td>${columns.map((_,columnIndex)=>`<td><span class='mv-skeleton-cell ${columnIndex===2?'wide':''}'></span></td>`).join('')}<td><span class='mv-skeleton-cell short'></span></td></tr>`).join('');resultEl.innerHTML=`${toolbar}<div class='table-wrap table-wrap-full' aria-busy='${st.loading}' aria-live='polite'><table class='${st.loading?'transaction-loading-table':''}'><thead><tr><th></th>${columns.map(column=>`<th>${esc(TRANSACTION_COLUMN_LABELS[column]||String(column).toUpperCase())}</th>`).join('')}<th>Aksi</th></tr></thead><tbody>${body}</tbody></table>${st.loading?"<div class='transaction-loading-label'>Memuat data...</div>":''}</div><div class='mv-pagination'><span>Halaman ${st.page}</span><div class='row'><button class='btn-ghost' disabled>Prev</button><button class='btn-ghost' disabled>Next</button></div></div>`;}
function renderDataTablePage(mode,sheetName,keepPage=false,selectedCols){const isIn=mode==="in", resultEl=isIn?inResults:outResults;if(!resultEl)return;const st=TABLE_STATE[mode];if(st.loading||st.error){renderTransactionLoadingState(mode,resultEl);return;}st.filtered=getMovementFilteredRows(mode,sheetName);const rows=st.rows;if(!rows.length){const emptyColumns=isIn?BARANG_MASUK_PRESENTATION_COLUMNS:BARANG_KELUAR_PRESENTATION_COLUMNS;resultEl.innerHTML=`<div class='mv-toolbar'><button class='btn-ghost' data-mv-action='reset' data-mv-mode='${mode}'>Reset Filter</button><select id='mv-size-${mode}' data-mv-filter data-mv-mode='${mode}'><option value='25'>25</option><option value='50'>50</option></select></div><div class='table-wrap table-wrap-full'><table><thead><tr>${emptyColumns.map(c=>`<th>${esc(TRANSACTION_COLUMN_LABELS[c])}</th>`).join('')}<th>AKSI</th></tr></thead><tbody><tr><td colspan='${emptyColumns.length+1}'><div class='state'>Belum ada data.</div></td></tr></tbody></table></div><div class='mv-pagination'><span>Menampilkan 0–0 dari 0 data</span><div class='row'><button class='btn-ghost' disabled>Prev</button><button class='btn-ghost' disabled>Next</button></div></div>`;return;}const allCols=getMovementColumns(rows,mode);ensureMovementFilterColumns(allCols);st.columns=allCols;st.pageSize=Number(document.getElementById(`mv-size-${mode}`)?.value||25);if(![25,50].includes(st.pageSize))st.pageSize=25;if(!keepPage)st.page=1;const size=st.pageSize;
const pageRows=st.filtered;const filterHtml=`<div class='mv-toolbar'><button class='btn-ghost' data-mv-action='reset' data-mv-mode='${mode}'>Reset Filter</button><select id='mv-sort-${mode}' data-mv-filter data-mv-mode='${mode}'><option value='latest' ${st.sort==='latest'?'selected':''}>Terbaru</option><option value='oldest' ${st.sort==='oldest'?'selected':''}>Terlama</option><option value='sku-asc' ${st.sort==='sku-asc'?'selected':''}>SKU A-Z</option><option value='name-asc' ${st.sort==='name-asc'?'selected':''}>Nama A-Z</option><option value='qty-desc' ${st.sort==='qty-desc'?'selected':''}>Qty terbesar</option><option value='qty-asc' ${st.sort==='qty-asc'?'selected':''}>Qty terkecil</option></select><select id='mv-size-${mode}' data-mv-filter data-mv-mode='${mode}'><option value='25' ${st.pageSize===25?'selected':''}>25</option><option value='50' ${st.pageSize===50?'selected':''}>50</option></select></div>`;
const filters=ensureColumnFilterState(mode);
const headerWithFilter=(c)=>{if(!FILTERABLE_COLUMNS.includes(c))return `<th>${esc((FILTER_LABELS[c]||c).toUpperCase())}</th>`;const selected=filters[c]||[];const active=selected.length>0;const options=getUniqueOptions(applyTableFilters(rows,mode,c),c);return `<th><div class='th-filter-wrap'>${esc((FILTER_LABELS[c]||c).toUpperCase())}<button class='th-filter-btn ${active?'active':''}' type='button' data-col-filter-toggle data-mode='${mode}' data-col='${c}'><span class='th-filter-icon'>▾</span>${active?`<span class='th-filter-count'>${selected.length}</span>`:''}</button><div class='th-filter-dropdown' data-col-filter-menu data-mode='${mode}' data-col='${c}' hidden><input class='th-filter-search' data-col-filter-search placeholder='Cari nilai...'><div class='th-filter-actions'><button type='button' data-col-filter-clear>Semua</button></div><div class='th-filter-options'>${renderColumnFilterOptions(options,selected)}</div></div></div></th>`;};
const allVisibleSelected=pageRows.length>0&&pageRows.every(r=>st.selected.has(r.rowNumber));const headers=`<th><input type='checkbox' data-mv-select-all='${mode}' ${allVisibleSelected?"checked":""}></th>`+st.columns.map(c=>headerWithFilter(c)).join("")+`<th>Aksi</th>`;const bodyRows=[];for(const r of pageRows){const isDeleting=st.deletingRows?.has(r.rowNumber);bodyRows.push(`<tr class='${st.selected.has(r.rowNumber)?"mv-row-selected":""}'><td><input type='checkbox' data-mv-select='${mode}' data-row='${r.rowNumber}' ${st.selected.has(r.rowNumber)?"checked":""} ${isDeleting?"disabled":""}></td>${st.columns.map(c=>c==="dokumen"?`<td class='presentation-cell document-cell'>${renderDocumentValue(r?._rawCells?.[c])}</td>`:`<td class='editable-cell ${c==="stockout"?"presentation-cell":""}' data-mv-cell='1' data-mode='${mode}' data-row='${r.rowNumber}' data-field='${c}'>${renderPresentationValue(c,r?._rawCells?.[c])}</td>`).join("")}<td><button class='icon-btn danger' data-mv-delete='${mode}' data-row='${r.rowNumber}' title='Delete' aria-label='Delete' ${isDeleting?"disabled":""}>${isDeleting?"<span class='btn-spinner-inline' aria-hidden='true'></span>":"<i data-lucide='trash-2'></i>"}</button></td></tr>`);}const body=bodyRows.join("");const start=st.filtered.length?((st.page-1)*st.pageSize+1):0;const end=st.filtered.length?Math.min(start+st.filtered.length-1,st.total):0;
const selCount=st.selected.size;const bulkBar=selCount?`<div class='mv-toolbar mv-bulkbar ${st.bulkDeleting?"is-loading":""}' data-mv-bulkbar='${mode}'><span class='mv-bulkbar-count'>Selected ${selCount} item</span><button class='btn-ghost mv-bulk-btn' type='button' data-mv-bulk-edit='${mode}' ${st.bulkDeleting?"disabled":""}><i data-lucide='pencil'></i> <span>Edit</span></button><button class='btn-ghost mv-bulk-btn' type='button' data-mv-bulk-delete='${mode}' ${st.bulkDeleting?"disabled":""}>${st.bulkDeleting?"<span class='btn-spinner-inline' aria-hidden='true'></span> <span>Menghapus...</span>":"<i data-lucide='trash-2'></i> <span>Delete</span>"}</button></div>`:"";
resultEl.innerHTML=`${bulkBar}${filterHtml}<div class='table-wrap table-wrap-full'><table><thead><tr>${headers}</tr></thead><tbody>${body||`<tr><td colspan='${st.columns.length+2}'><div class='state'>Tidak ada data.</div></td></tr>`}</tbody></table></div><div class='mv-pagination'><span>Menampilkan ${start}–${end} dari ${st.total} data</span><div class='row'><button class='btn-ghost' data-mv-action='prev' data-mv-mode='${mode}'>Prev</button><button class='btn-ghost' data-mv-action='next' data-mv-mode='${mode}'>Next</button></div></div>`;if(st.openFilterCol){const menu=resultEl.querySelector(`[data-col-filter-menu][data-mode='${mode}'][data-col='${st.openFilterCol}']`);if(menu){menu.hidden=false;positionColumnFilterMenu(menu);}}if(window.lucide)window.lucide.createIcons();}
function resetMovementFilter(mode){if(mode==="in"){if(inSearch)inSearch.value="";}else{if(outSearch)outSearch.value="";}TABLE_STATE[mode].columnFilters={};if(TABLE_STATE[mode])TABLE_STATE[mode].page=1;if(BALIKAN_STATE.filterState&&mode==='balikan')BALIKAN_STATE.filterState.page=1;if(mode==="in"||mode==="out")return loadTransactionTablePage(mode,{page:1,search:""});rerenderTableByMode(mode,true);}
function getAllValidLocations(){const all=[];for(let zoneCode=65;zoneCode<=72;zoneCode++){const zone=String.fromCharCode(zoneCode);for(let slot=1;slot<=20;slot++){for(let floor=1;floor<=5;floor++){const code=`${zone}${String(slot).padStart(2,"0")}-${floor}`;const parsed=parseLocationCode(code);if(parsed.valid&&!parsed.blocked)all.push(parsed.raw);}}}return all;}
function renderEmptyLocations(){const used=new Set();(DATA["Kartu Stock"]||[]).forEach(r=>{const stokAkhir=parseNumber(getVal(r,["stok akhir","closing stock","ending stock","saldo akhir"]));if(stokAkhir<=0)return;const locRaw=getVal(r,["lokasi","location","rak","bin","area"]);const parsed=parseLocationCode(locRaw);if(parsed.valid&&!parsed.blocked)used.add(parsed.raw);});const empty=getAllValidLocations().filter(code=>!used.has(code));if(!empty.length){emptyLocationResult.innerHTML='<div class="state">Tidak ada lokasi kosong.</div>';return;}const rows=empty.map((code,idx)=>`<tr><td>${idx+1}</td><td>${esc(code)}</td></tr>`).join("");emptyLocationResult.innerHTML=`<div class="detail-note"><div class="note-box"><div class="note-title">Daftar Lokasi Kosong</div><div class="note-value">${empty.length} lokasi kosong</div></div></div><div class="table-wrap"><table class="location-empty-table"><thead><tr><th>No</th><th>Lokasi Kosong</th></tr></thead><tbody>${rows}</tbody></table></div>`;}
function parseLocationCode(value){const raw=String(value||"").trim().toUpperCase();const m=raw.match(/^([A-H])(\d{2})-(\d)$/);if(!m)return{raw,valid:false,reason:"Format tidak valid. Gunakan pola seperti A01-1 sampai H20-5."};const zone=m[1],slot=Number(m[2]),floor=Number(m[3]);if(slot<1||slot>20)return{raw,valid:false,reason:"Nomor lokasi harus 01 sampai 20."};if(floor<1||floor>5)return{raw,valid:false,reason:"Lantai harus 1 sampai 5."};const blocked=slot===7&&floor>=1&&floor<=3;return{raw:`${zone}${String(slot).padStart(2,"0")}-${floor}`,valid:true,blocked,zone,slot,floor};}
function checkLocation(){const result=parseLocationCode(locInput.value);if(!result.valid){locationResult.innerHTML=`<div class="state error">${esc(result.reason)}</div>`;return;}if(result.blocked){locationResult.innerHTML=`<div class="state error">Lokasi <strong>${esc(result.raw)}</strong> tidak bisa digunakan (blokir A07-1 sampai H07-3).</div>`;return;}const rows=(DATA["Kartu Stock"]||[]).filter(r=>{const loc=getVal(r,["lokasi","location","rak","bin","area"]);return clean(loc)===clean(result.raw);});if(!rows.length){locationResult.innerHTML=`<div class="state">Lokasi <strong>${esc(result.raw)}</strong> belum ada data di Kartu Stock.</div>`;return;}const skuMap=new Map();rows.forEach(r=>{const sku=getVal(r,["sku"])||"-";const nama=getVal(r,["nama barang","nama","item","description"])||"-";const stokAwal=parseNumber(getVal(r,["stok awal","opening stock","beginning stock","saldo awal"]));const pengeluaran=parseNumber(getVal(r,["pengeluaran","qty keluar","keluar","out"]));const stokAkhir=parseNumber(getVal(r,["stok akhir","closing stock","ending stock","saldo akhir"]));const key=clean(sku||nama);if(!skuMap.has(key))skuMap.set(key,{sku,nama,stokAwal:0,pengeluaran:0,stokAkhir:0});const item=skuMap.get(key);item.stokAwal+=stokAwal;item.pengeluaran+=pengeluaran;item.stokAkhir+=stokAkhir;});const details=[...skuMap.values()].filter(d=>d.stokAkhir!==0).sort((a,b)=>b.stokAkhir-a.stokAkhir||a.sku.localeCompare(b.sku));if(!details.length){locationResult.innerHTML=`<div class="state">Lokasi <strong>${esc(result.raw)}</strong> hanya memiliki data dengan stok akhir 0.</div>`;return;}locationResult.innerHTML=`<div class="detail-note"><div class="note-box"><div class="note-title">Ringkasan Lokasi ${esc(result.raw)}</div><div class="note-value">${details.length} SKU unik • ${rows.length} baris Kartu Stock</div></div></div><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Nama</th><th>Stok Awal</th><th>Pengeluaran</th><th>Stok Akhir</th><th>DETAIL</th></tr></thead><tbody>${details.map(d=>{const skuValid=String(d.sku||"" ).trim()&&d.sku!=="-";return `<tr><td><div class="copy-cell"><span class="copy-cell-text">${esc(d.sku)}</span><button class="copy-mini-btn" type="button" title="Copy" aria-label="Copy SKU" onclick="copyText(decodeURIComponent('${encAttr(d.sku)}'),'SKU disalin',this)"><span aria-hidden='true'>⧉</span><span>Copy</span></button></div></td><td><div class="copy-cell"><span class="copy-cell-text">${esc(d.nama)}</span><button class="copy-mini-btn" type="button" title="Copy" aria-label="Copy nama barang" onclick="copyText(decodeURIComponent('${encAttr(d.nama)}'),'Nama barang disalin',this)"><span aria-hidden='true'>⧉</span><span>Copy</span></button></div></td><td>${esc(d.stokAwal)}</td><td>${esc(d.pengeluaran)}</td><td>${esc(d.stokAkhir)}</td><td class="action-cell">${skuValid?`<button class="detail-mini-btn" type="button" onclick="navigateToSku(decodeURIComponent('${encAttr(d.sku)}'))">Lihat</button>`:""}</td></tr>`;}).join("")}</tbody></table></div>`;}

const LOCATION_CACHE_LIMIT=8;
const LOCATION_STATE={rows:[],page:1,pageSize:25,total:0,selected:"",loading:false,error:"",emptyPage:1,emptyPageSize:25,emptyTotal:0,summary:null,pageCache:new Map(),detailCache:new Map(),requestToken:0};
const LOCATION_STATUS_META={"Kosong":{cls:"loc-status-empty",icon:"map-pin-off"},"Sedikit":{cls:"loc-status-low",icon:"package-minus"},"Normal":{cls:"loc-status-normal",icon:"badge-check"},"Padat":{cls:"loc-status-dense",icon:"boxes"}};
function renderLocationStatusBadge(status){const meta=LOCATION_STATUS_META[status]||LOCATION_STATUS_META.Normal;return `<span class='loc-status-badge ${meta.cls}'><i data-lucide='${meta.icon}'></i><span>${esc(status)}</span></span>`;}
function renderLocationMetric(icon,label,value,extraClass=""){return `<span class='loc-cell-metric ${extraClass}'><i data-lucide='${icon}'></i><span class='loc-cell-label'>${esc(label)}</span><strong>${esc(value)}</strong></span>`;}
function locationParams(page=LOCATION_STATE.page){return {page:String(page),limit:String(LOCATION_STATE.pageSize),search:normalizeSearch(locSearchInput?.value),status:locStatusFilter?.value||'all',type:locTypeFilter?.value||'all',sort:locSort?.value||'skuDesc'};}
function locationCacheKey(params){return new URLSearchParams(params).toString();}
function setLimitedCache(cache,key,value){cache.delete(key);cache.set(key,value);while(cache.size>LOCATION_CACHE_LIMIT)cache.delete(cache.keys().next().value);}
async function fetchLocationJson(path,signal){const headers=await getAuthHeaders();const {res,data}=await fetchJsonSafe(path,{headers,signal,cache:'no-store'});if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal memuat data lokasi');return data;}
function renderLocationShell(){if(!locationsSummary||!locationsTable||!locationsEmpty)return;locationsSummary.innerHTML=[["map-pin","Total Lokasi"],["package","Total SKU berlokasi"]].map(c=>`<div class='metric location-summary-card'><div class='k'><i data-lucide='${c[0]}'></i><span>${c[1]}</span></div><div class='v'>—</div></div>`).join('');locationsTable.innerHTML=`<div class='card'><div class='section-header'><h4><i data-lucide='map-pinned'></i> List Lokasi</h4></div><div class='table-wrap table-wrap-full' aria-busy='true'><table><thead><tr><th>No</th><th>Lokasi</th><th>Jumlah SKU</th><th>Total Qty</th><th>Status</th><th>Aksi</th></tr></thead><tbody><tr><td colspan='6'><div class='state'>Memuat daftar lokasi…</div></td></tr></tbody></table></div></div>`;locationsEmpty.innerHTML=`<div class='card'><div class='section-header'><h4><i data-lucide='map-pin-off'></i> Lokasi Kosong</h4></div><div class='state'>Memuat lokasi kosong…</div></div>`;if(window.lucide)window.lucide.createIcons();}
function drawLocationSummary(summary){LOCATION_STATE.summary=summary;locationsSummary.innerHTML=[["map-pin","Total Lokasi",summary.totalLocations],["package","Total SKU berlokasi",summary.totalLocatedSku]].map(c=>`<div class='metric location-summary-card'><div class='k'><i data-lucide='${c[0]}'></i><span>${c[1]}</span></div><div class='v'>${esc(c[2])}</div></div>`).join('');}
function drawLocations(){const rows=LOCATION_STATE.rows||[],start=rows.length?(LOCATION_STATE.page-1)*LOCATION_STATE.pageSize+1:0,end=Math.min(LOCATION_STATE.page*LOCATION_STATE.pageSize,LOCATION_STATE.total),max=Math.max(1,Math.ceil(LOCATION_STATE.total/LOCATION_STATE.pageSize));locationsTable.innerHTML=`<div class='card'><div class='section-header'><h4><i data-lucide='map-pinned'></i> List Lokasi</h4><span class='badge b-kartu'>${LOCATION_STATE.total}</span></div><div class='subtitle'>Urutan lokasi sesuai filter dan sorting aktif</div><div class='table-wrap table-wrap-full' aria-busy='${LOCATION_STATE.loading}'><table><thead><tr><th>No</th><th>Lokasi</th><th>Jumlah SKU</th><th>Total Qty</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.map((r,idx)=>`<tr><td class='loc-row-no'>${start+idx}</td><td><span class='loc-name'><i data-lucide='map-pin'></i><strong>${esc(r.lokasi)}</strong></span></td><td>${renderLocationMetric('package','SKU',r.jumlahSku,'loc-sku-metric')}</td><td>${renderLocationMetric('boxes','Qty',r.totalQty,'loc-qty-metric')}</td><td>${renderLocationStatusBadge(r.status)}</td><td><button class='btn-ghost loc-action-btn' onclick="selectLocationDetail('${encAttr(r.lokasi)}')">Lihat SKU</button></td></tr>`).join('')||`<tr><td colspan='6'><div class='state ${LOCATION_STATE.error?'error':''}'>${esc(LOCATION_STATE.error||'Tidak ada data.')}</div></td></tr>`}</tbody></table></div><div class='mv-pagination'><span>Menampilkan ${start}–${end} dari ${LOCATION_STATE.total} data</span><div class='row'><button class='btn-ghost' onclick='changeLocationPage(-1)' ${LOCATION_STATE.page<=1?'disabled':''}>Prev</button><button class='btn-ghost' onclick='changeLocationPage(1)' ${LOCATION_STATE.page>=max?'disabled':''}>Next</button></div></div></div>`;if(window.lucide)window.lucide.createIcons();}
async function loadLocationSummary(){if(LOCATION_STATE.summary){drawLocationSummary(LOCATION_STATE.summary);return;}const data=await fetchLocationJson('/api/location-summary');drawLocationSummary(data);}
async function loadLocationPage(page){const params=locationParams(page),key=locationCacheKey(params),cached=LOCATION_STATE.pageCache.get(key);if(cached){LOCATION_STATE.page=page;LOCATION_STATE.rows=cached.rows;LOCATION_STATE.total=cached.total;LOCATION_STATE.loading=false;drawLocations();return cached;}const token=++LOCATION_STATE.requestToken;LOCATION_STATE.loading=true;LOCATION_STATE.error='';drawLocations();const data=await fetchLocationJson(`/api/locations?${new URLSearchParams(params)}`);setLimitedCache(LOCATION_STATE.pageCache,key,data);if(token!==LOCATION_STATE.requestToken)return data;LOCATION_STATE.page=data.page;LOCATION_STATE.rows=data.rows||[];LOCATION_STATE.total=Number(data.total)||0;LOCATION_STATE.loading=false;drawLocations();return data;}
async function loadEmptyLocations(page=1){const data=await fetchLocationJson(`/api/locations/empty?page=${page}&limit=${LOCATION_STATE.emptyPageSize}`);LOCATION_STATE.emptyPage=data.page;LOCATION_STATE.emptyTotal=data.total;const rows=data.rows||[],start=rows.length?(data.page-1)*data.limit+1:0;locationsEmpty.innerHTML=`<div class='card'><div class='section-header'><h4><i data-lucide='map-pin-off'></i> Lokasi Kosong</h4><span class='badge b-kartu'>${data.total}</span></div><div class='subtitle'>Lokasi valid yang belum terisi stok aktif</div><div class='table-wrap'><table><thead><tr><th>No</th><th>Lokasi</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${start+i}</td><td><span class='loc-name'><i data-lucide='map-pin'></i><strong>${esc(r.lokasi)}</strong></span></td></tr>`).join('')}</tbody></table></div></div>`;if(window.lucide)window.lucide.createIcons();}
function renderLocationsPage(){if(!locSearchInput?.dataset.bound){const reload=debounce(()=>{LOCATION_STATE.page=1;loadLocationPage(1).catch(showLocationError);},400);locSearchInput.addEventListener('input',reload);[locStatusFilter,locTypeFilter,locSort,locPageSize].forEach(el=>el?.addEventListener('change',()=>{LOCATION_STATE.page=1;LOCATION_STATE.pageSize=25;loadLocationPage(1).catch(showLocationError);}));locSearchInput.dataset.bound='1';}if(!LOCATION_STATE.summary&&!LOCATION_STATE.rows.length)renderLocationShell();Promise.allSettled([loadLocationSummary(),loadLocationPage(LOCATION_STATE.page),loadEmptyLocations(LOCATION_STATE.emptyPage)]).then(results=>results.forEach(r=>{if(r.status==='rejected')console.error('[Locations]',r.reason);}));}
function showLocationError(error){LOCATION_STATE.loading=false;LOCATION_STATE.error=error?.message||'Gagal memuat daftar lokasi';drawLocations();}
function changeLocationPage(step){const max=Math.max(1,Math.ceil(LOCATION_STATE.total/LOCATION_STATE.pageSize)),next=Math.min(max,Math.max(1,LOCATION_STATE.page+step));if(next!==LOCATION_STATE.page)loadLocationPage(next).catch(showLocationError);}
async function selectLocationDetail(locEncoded,page=1){const lokasi=decodeURIComponent(locEncoded||'');LOCATION_STATE.selected=lokasi;locationDetail.innerHTML=`<div class='card'><div class='section-header'><h4>Detail Lokasi: ${esc(lokasi)}</h4></div><div class='state'>Memuat SKU lokasi ini…</div></div>`;if(page===1)locationDetail.scrollIntoView({behavior:'smooth',block:'start'});const params={lokasi,page:String(page),limit:'25'},key=locationCacheKey(params);try{let data=LOCATION_STATE.detailCache.get(key);if(!data){data=await fetchLocationJson(`/api/location-detail?${new URLSearchParams(params)}`);setLimitedCache(LOCATION_STATE.detailCache,key,data);}const rows=data.rows||[],max=Math.max(1,Math.ceil(data.total/data.limit));locationDetail.innerHTML=`<div class='card'><div class='section-header'><h4>Detail Lokasi: ${esc(lokasi)}</h4><span class='badge b-kartu'>${data.total}</span></div><div class='table-wrap table-wrap-full'><table><thead><tr><th>SKU</th><th>Nama Barang</th><th>Qty / Stok</th><th>Aksi</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${esc(s.sku)}</td><td>${esc(s.nama)}</td><td>${esc(s.qty)}</td><td><button class='btn-primary' onclick="navigateTo('/sku/'+encodeURIComponent('${encAttr(s.sku)}'))">Lihat Detail SKU</button></td></tr>`).join('')||`<tr><td colspan='4'>Tidak ada SKU aktif.</td></tr>`}</tbody></table></div><div class='mv-pagination'><span>Halaman ${data.page} dari ${max}</span><div class='row'><button class='btn-ghost' ${data.page<=1?'disabled':''} onclick="selectLocationDetail('${encAttr(lokasi)}',${data.page-1})">Prev</button><button class='btn-ghost' ${data.page>=max?'disabled':''} onclick="selectLocationDetail('${encAttr(lokasi)}',${data.page+1})">Next</button></div></div></div>`;}catch(error){locationDetail.innerHTML=`<div class='state error'>${esc(error?.message||'Gagal memuat detail lokasi')}</div>`;}}
function exportLocationCsv(){const cols=['lokasi','jumlah_sku','total_qty','status'];const lines=[cols.join(','),...(LOCATION_STATE.rows||[]).map(r=>[r.lokasi,r.jumlahSku,r.totalQty,r.status].map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(','))];const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`locations-page-${LOCATION_STATE.page}.csv`;a.click();URL.revokeObjectURL(a.href);}
window.renderLocationsPage=renderLocationsPage;window.changeLocationPage=changeLocationPage;window.selectLocationDetail=selectLocationDetail;window.exportLocationCsv=exportLocationCsv;

function getRecentSearches(){try{const raw=localStorage.getItem(CACHE_KEYS.searchHistory);const list=JSON.parse(raw||"[]");return Array.isArray(list)?list.filter(Boolean).slice(0,5):[];}catch(_){return [];}}
function saveRecentSearch(query){const q=String(query||"").trim();if(!q)return;const recent=[q,...getRecentSearches().filter(x=>clean(x)!==clean(q))].slice(0,5);try{localStorage.setItem(CACHE_KEYS.searchHistory,JSON.stringify(recent));}catch(_){}renderRecentHistory();}
function clearSearchHistory(){localStorage.removeItem(CACHE_KEYS.searchHistory);renderRecentHistory();}

const STOK_MINUS_CACHE_KEY="stokMinusCacheV2";
const STOK_MINUS_STATE={q:"",searchInputValue:"",filter:"all",sort:"minusDesc",page:1,pageSize:25,selected:"",rows:[],filteredRows:[],_searchDebounce:null,_idleFilter:null,_refreshTimer:null,isLoading:false,lastRenderToken:0};
function getStokMinusSource(){
  return {
    masuk:getBarangMasukRows(),
    keluar:getBarangKeluarRows(),
    kartu:DATA["Kartu Stock"]||[],
    rpl:DATA["RPL"]||[],
    bulky:DATA["BULKY"]||[]
  };
}
function mapRowsBySku(rows=[]){const map=new Map();for(const row of rows){const sku=String(getVal(row,["sku"])||"").trim();if(!sku)continue;const key=clean(sku);if(!map.has(key))map.set(key,[]);map.get(key).push(row);}return map;}
function buildQtyMap(rows=[]){const map=new Map();for(const r of rows){const sku=String(getVal(r,["sku"])||"").trim();if(!sku)continue;const key=clean(sku);map.set(key,(map.get(key)||0)+Math.abs(parseNumber(getVal(r,["qty"]))));}return map;}
function buildStokMinusRows(source=getStokMinusSource()){
  const inMap=buildQtyMap(source.masuk),outMap=buildQtyMap(source.keluar);
  const masukBySku=mapRowsBySku(source.masuk),keluarBySku=mapRowsBySku(source.keluar),rplBySku=mapRowsBySku(source.rpl),bulkyBySku=mapRowsBySku(source.bulky);
  const grouped=new Map();
  for(const row of source.kartu){const sku=String(getVal(row,["sku"])||"").trim();if(!sku)continue;const stokAkhir=parseNumber(getVal(row,["stok akhir","closing stock","ending stock","saldo akhir"]));if(stokAkhir>=0)continue;const key=clean(sku);const nama=String(getVal(row,["nama barang","nama","item","description"])||"-").trim()||"-";if(!grouped.has(key))grouped.set(key,{sku,nama,stokEstimate:0,kartuRows:[]});const it=grouped.get(key);if(it.nama==="-"&&nama!=="-")it.nama=nama;it.stokEstimate+=stokAkhir;it.kartuRows.push(row);}
  const out=[];for(const [key,it] of grouped.entries()){const totalMasuk=inMap.get(key)||0,totalKeluar=outMap.get(key)||0;const keluarTanpaMasuk=totalKeluar>0&&totalMasuk<=0;out.push({...it,totalMasuk,totalKeluar,selisih:it.stokEstimate,status:keluarTanpaMasuk?"Keluar Tanpa Masuk":"Stok Minus",inRows:masukBySku.get(key)||[],outRows:keluarBySku.get(key)||[],rplRows:rplBySku.get(key)||[],bulkyRows:bulkyBySku.get(key)||[]});}
  return out;
}
function getStokMinusSourceVersion(source=getStokMinusSource()){return [source.masuk.length,source.keluar.length,source.kartu.length,source.rpl.length,source.bulky.length].join("|");}
function getStokMinusCache(){try{const raw=localStorage.getItem(STOK_MINUS_CACHE_KEY);const parsed=JSON.parse(raw||"null");if(!parsed||!Array.isArray(parsed.rows))return null;return parsed;}catch(_){return null;}}
function setStokMinusCache(rows,version){try{localStorage.setItem(STOK_MINUS_CACHE_KEY,JSON.stringify({version,rows,updatedAt:Date.now()}));}catch(_){}} 
function setStokMinusLoading(loading=true,msg="Memproses data stok minus..."){STOK_MINUS_STATE.isLoading=loading;const loadingEl=document.getElementById('stokMinusLoading');if(loadingEl){loadingEl.classList.toggle('hidden',!loading);loadingEl.textContent=msg;}}
function renderStokMinusSummarySkeleton(){stokMinusSummary.innerHTML=[1,2,3,4].map(()=>"<div class='metric'><div class='k'>...</div><div class='v'>...</div></div>").join("");}
function getStokMinusFilteredRows(){let rows=(STOK_MINUS_STATE.rows||[]).filter(r=>{const q=clean(STOK_MINUS_STATE.q);if(q&&!clean(`${r.sku} ${r.nama}`).includes(q))return false;if(STOK_MINUS_STATE.filter==="minus")return r.status==="Stok Minus";if(STOK_MINUS_STATE.filter==="keluar")return r.status==="Keluar Tanpa Masuk";return true;});return [...rows].sort(STOK_MINUS_STATE.sort==="keluarDesc"?(a,b)=>b.totalKeluar-a.totalKeluar:STOK_MINUS_STATE.sort==="skuAz"?(a,b)=>a.sku.localeCompare(b.sku):(a,b)=>a.stokEstimate-b.stokEstimate);}
function renderStokMinusTableRowsOnly(){const rows=getStokMinusFilteredRows();STOK_MINUS_STATE.filteredRows=rows;const max=Math.max(1,Math.ceil(rows.length/STOK_MINUS_STATE.pageSize));if(STOK_MINUS_STATE.page>max)STOK_MINUS_STATE.page=max;const pageRows=rows.slice((STOK_MINUS_STATE.page-1)*STOK_MINUS_STATE.pageSize,STOK_MINUS_STATE.page*STOK_MINUS_STATE.pageSize);const tbody=document.querySelector('#page-stok-minus #stokMinusTable tbody');if(tbody)tbody.innerHTML=pageRows.map(r=>`<tr><td>${esc(r.sku)}</td><td class='cell-nama'>${esc(r.nama)}</td><td>${r.totalMasuk}</td><td>${r.totalKeluar}</td><td class='${r.stokEstimate<0?"txt-danger":""}'>${r.stokEstimate}</td><td><span class='badge stokminus-badge ${r.status==="Stok Minus"?"b-out":"b-warn"}'>${esc(r.status)}</span></td><td><button class='btn-ghost stokminus-track-btn' onclick="openStokMinusTrace('${encAttr(r.sku)}')">Lacak</button></td></tr>`).join("")||"<tr><td colspan='7'><div class='state'>Tidak ada data.</div></td></tr>";const info=document.querySelector('#page-stok-minus .stokminus-pagination span');if(info)info.textContent=`Menampilkan ${rows.length?((STOK_MINUS_STATE.page-1)*STOK_MINUS_STATE.pageSize+1):0}–${Math.min(STOK_MINUS_STATE.page*STOK_MINUS_STATE.pageSize,rows.length)} dari ${rows.length} data`;}
function scheduleStokMinusSearchFilter(){if(STOK_MINUS_STATE._idleFilter)clearTimeout(STOK_MINUS_STATE._idleFilter);const run=()=>{STOK_MINUS_STATE.q=STOK_MINUS_STATE.searchInputValue;STOK_MINUS_STATE.page=1;renderStokMinusTableRowsOnly();};if(typeof requestIdleCallback==="function"){requestIdleCallback(run,{timeout:200});return;}STOK_MINUS_STATE._idleFilter=setTimeout(run,0);}
function renderStokMinusSummary(all=[]){const minusQty=all.reduce((n,r)=>n+(r.stokEstimate<0?Math.abs(r.stokEstimate):0),0);const onlyOut=all.filter(r=>r.status==="Keluar Tanpa Masuk").length;const topMinus=[...all].sort((a,b)=>a.stokEstimate-b.stokEstimate)[0];stokMinusSummary.innerHTML=[["Total SKU Minus",all.length],["Total Qty Minus",minusQty],["Keluar Tanpa Masuk",onlyOut],["Minus Terbesar",topMinus?`${topMinus.sku} (${topMinus.stokEstimate})`:"-"]].map(c=>`<div class='metric'><div class='k'>${c[0]}</div><div class='v'>${esc(c[1])}</div></div>`).join("");}
function applyStokMinusRows(rows=[]){STOK_MINUS_STATE.rows=rows;renderStokMinusSummary(rows);renderStokMinusTableRowsOnly();if(STOK_MINUS_STATE.selected)openStokMinusTrace(encAttr(STOK_MINUS_STATE.selected),true);}
function refreshStokMinusInBackground(){
  const token=++STOK_MINUS_STATE.lastRenderToken;const source=getStokMinusSource();const version=getStokMinusSourceVersion(source);
  const run=()=>{const computed=buildStokMinusRows(source);if(token!==STOK_MINUS_STATE.lastRenderToken)return;applyStokMinusRows(computed);setStokMinusCache(computed,version);setStokMinusLoading(false);};
  setStokMinusLoading(true,"Memperbarui stok minus terbaru di background...");
  if(typeof requestIdleCallback==="function"){requestIdleCallback(run,{timeout:800});return;}
  setTimeout(run,0);
}
function renderStokMinusPage(){renderStokMinusSummarySkeleton();stokMinusTable.innerHTML=`<div class='stokminus-card'><div class='mv-toolbar stokminus-toolbar'><input id='minusSearch' class='search-lg' placeholder='Search SKU / nama barang' value='${esc(STOK_MINUS_STATE.searchInputValue)}'><select id='minusFilter'><option value='all'>Semua</option><option value='minus'>Stok Minus</option><option value='keluar'>Keluar Tanpa Masuk</option></select><select id='minusSort'><option value='minusDesc'>Minus terbesar</option><option value='keluarDesc'>Keluar terbesar</option><option value='skuAz'>SKU A-Z</option></select><select id='minusSize'><option value='25'>25</option><option value='50'>50</option><option value='100'>100</option></select><button class='btn-ghost stokminus-export' onclick='exportStokMinusCsv()'>Export CSV</button></div><div id='stokMinusLoading' class='state'>Memuat stok minus...</div><div class='table-wrap table-wrap-full stokminus-table-wrap'><table><thead><tr><th class='col-sku'>SKU</th><th class='col-nama'>Nama Barang</th><th>Total Masuk</th><th>Total Keluar</th><th>Selisih</th><th>Status</th><th>Action Lacak</th></tr></thead><tbody></tbody></table></div><div class='mv-pagination stokminus-pagination'><span></span><div class='row'><button class='btn-ghost' onclick='changeStokMinusPage(-1)'>Prev</button><button class='btn-ghost' onclick='changeStokMinusPage(1)'>Next</button></div></div></div>`;document.getElementById('minusFilter').value=STOK_MINUS_STATE.filter;document.getElementById('minusSort').value=STOK_MINUS_STATE.sort;document.getElementById('minusSize').value=String(STOK_MINUS_STATE.pageSize);document.getElementById('minusSearch')?.addEventListener('input',e=>{STOK_MINUS_STATE.searchInputValue=e.target.value;clearTimeout(STOK_MINUS_STATE._searchDebounce);STOK_MINUS_STATE._searchDebounce=setTimeout(scheduleStokMinusSearchFilter,400);});document.getElementById('minusFilter')?.addEventListener('change',e=>{STOK_MINUS_STATE.filter=e.target.value;STOK_MINUS_STATE.page=1;renderStokMinusTableRowsOnly();});document.getElementById('minusSort')?.addEventListener('change',e=>{STOK_MINUS_STATE.sort=e.target.value;renderStokMinusTableRowsOnly();});document.getElementById('minusSize')?.addEventListener('change',e=>{STOK_MINUS_STATE.pageSize=Number(e.target.value)||25;STOK_MINUS_STATE.page=1;renderStokMinusTableRowsOnly();});renderStokMinusTableRowsOnly();const source=getStokMinusSource();const sourceVersion=getStokMinusSourceVersion(source);const cache=getStokMinusCache();if(cache&&Array.isArray(cache.rows)&&cache.rows.length){applyStokMinusRows(cache.rows);setStokMinusLoading(true,"Menampilkan cache, sinkronisasi data terbaru...");}else{setStokMinusLoading(true,"Menghitung stok minus...");}refreshStokMinusInBackground();}
function changeStokMinusPage(delta){const max=Math.max(1,Math.ceil((STOK_MINUS_STATE.filteredRows||[]).length/STOK_MINUS_STATE.pageSize));STOK_MINUS_STATE.page=Math.min(max,Math.max(1,STOK_MINUS_STATE.page+delta));renderStokMinusTableRowsOnly();}
function getTraceSkuNameVariants(row){const names=new Set();for(const sourceRow of [...(row.kartuRows||[]),...(row.rplRows||[]),...(row.bulkyRows||[]),...(row.inRows||[]),...(row.outRows||[])]){const nama=String(getVal(sourceRow,["nama barang","nama","item","description"])||"").trim();if(nama)names.add(nama);}return [...names];}
function openStokMinusTrace(skuEncoded,keep=false){const sku=decodeURIComponent(skuEncoded||"");STOK_MINUS_STATE.selected=sku;const row=(STOK_MINUS_STATE.rows||[]).find(r=>clean(r.sku)===clean(sku));if(!row){if(!keep)stokMinusPanel.innerHTML="";return;}const cause=[];if(row.totalKeluar>row.totalMasuk)cause.push("Qty keluar lebih besar dari qty masuk");if(row.totalMasuk===0&&row.totalKeluar>0)cause.push("Ada transaksi keluar tanpa riwayat barang masuk");if(!row.kartuRows.length)cause.push("SKU tidak ditemukan di Kartu Stock");const nameVariants=getTraceSkuNameVariants(row);if(nameVariants.length>1)cause.push(`SKU memiliki nama berbeda dalam 1 SKU (${nameVariants.slice(0,3).join(" / ")}), berpotensi menyebabkan stok minus`);stokMinusPanel.innerHTML=`<div class='card stokminus-trace'><div class='section-header'><h4>Lacak SKU: ${esc(row.sku)}</h4></div><div class='summary-grid'><div class='summary-card'><div class='k'>Timeline Barang Masuk</div><div class='v'>${row.inRows.length} baris</div></div><div class='summary-card'><div class='k'>Timeline Barang Keluar</div><div class='v'>${row.outRows.length} baris</div></div><div class='summary-card'><div class='k'>Kartu Stock</div><div class='v'>${row.kartuRows.length} baris</div></div><div class='summary-card'><div class='k'>RPL / BULKY</div><div class='v'>${row.rplRows.length+row.bulkyRows.length} baris</div></div></div><div class='detail-note'><div class='note-box'><div class='note-title'>Kemungkinan penyebab</div><div class='note-value'>${cause.length?cause.map(esc).join(' • '):'Perlu audit manual per dokumen transaksi.'}</div></div></div>${renderTraceTable('Kartu Stock',row.kartuRows)}${renderTraceTable('RPL',row.rplRows)}${renderTraceTable('BULKY',row.bulkyRows)}${renderTraceTable('Barang Masuk',row.inRows)}${renderTraceTable('Barang Keluar',row.outRows)}</div>`;if(!keep){stokMinusPanel.scrollIntoView({behavior:'smooth',block:'start'});}}
function renderTraceTable(title,rows){return `<details class='source-card' ${rows.length?'open':''}><summary><span><span class='badge ${badgeClass(title)}'>${esc(title)}</span></span><span>${rows.length} baris</span></summary><div class='source-body'>${renderTable(rows)}</div></details>`;}
function exportStokMinusCsv(){const cols=["sku","nama","total_masuk","total_keluar","selisih","status"];const lines=[cols.join(',')].concat((STOK_MINUS_STATE.rows||[]).map(r=>[r.sku,r.nama,r.totalMasuk,r.totalKeluar,r.stokEstimate,r.status].map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(',')));const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='stok-minus.csv';a.click();URL.revokeObjectURL(a.href);}
function renderRecentHistory(){const wrap=document.getElementById("recentSearch");if(!wrap)return;const items=getRecentSearches();if(!items.length){wrap.innerHTML="";return;}wrap.innerHTML=`<div class='row recent-searches'>${items.map(x=>`<button class='chip' data-history='${encAttr(x)}'>${esc(x)}</button>`).join("")}</div>`;}
function handleSearchShortcuts(e){const key=(e.key||"").toLowerCase();if((e.ctrlKey||e.metaKey)&&key==="k"){e.preventDefault();openSearchModal();return;}if(key==="escape"&&searchModalOpen){e.preventDefault();closeSearchModal();}}
function openSearchModal(){prevRouteBeforeSearch=location.pathname||"/";searchModalOpen=true;if(location.pathname!=='/search')navigateTo('/search');setTimeout(()=>searchInput?.focus(),20);renderRecentHistory();}
function closeSearchModal(){searchModalOpen=false;if(location.pathname==='/search')navigateTo(prevRouteBeforeSearch==='/search'?'/':prevRouteBeforeSearch);}
function syncSearchModalUi(_open){}
window.loadAllData=loadAllData;window.syncData=syncData;window.loadCache=loadCache;window.saveCache=saveCache;window.isCacheFresh=isCacheFresh;window.clearCache=clearCache;window.clearSystemCache=clearSystemCache;window.exportLocationCsv=exportLocationCsv;window.toggleDark=toggleDark;window.toggleCompact=toggleCompact;window.setFilter=setFilter;window.copySku=copySku;window.copyText=copyText;window.showDetail=showDetail;window.navigateTo=navigateTo;window.navigateToSku=navigateToSku;window.goBackToPreviousPage=goBackToPreviousPage;window.showPage=showPage;window.resetMovementFilter=resetMovementFilter;window.renderDataTablePage=renderDataTablePage;window.applyTableFilters=applyTableFilters;window.sortTableRows=sortTableRows;window.paginateRows=paginateRows;window.exportFilteredCsv=exportFilteredCsv;window.getUniqueOptions=getUniqueOptions;window.toggleColumnVisibility=toggleColumnVisibility;window.toggleAllColumns=toggleAllColumns;window.changeStokMinusPage=changeStokMinusPage;window.openStokMinusTrace=openStokMinusTrace;window.exportStokMinusCsv=exportStokMinusCsv;

const ANOMALY_STATE={page:1,pageSize:25,total:0,rows:[],q:"",severity:"all",category:"all",source:"all",sort:"severity",categories:{},summary:null,rendered:false,isLoading:false,_searchDebounce:null,lastRenderToken:0};
function sevClass(s){return s==='High'?'b-high':s==='Medium'?'b-medium':'b-low';}
function warningQuery(){const p=new URLSearchParams({page:ANOMALY_STATE.page,limit:ANOMALY_STATE.pageSize,severity:ANOMALY_STATE.severity,category:ANOMALY_STATE.category,source:ANOMALY_STATE.source,sort:ANOMALY_STATE.sort});if(ANOMALY_STATE.q.trim())p.set('search',ANOMALY_STATE.q.trim());return p;}
function setAnomalyLoading(loading=true,msg="Memuat warning..."){ANOMALY_STATE.isLoading=loading;const wrap=document.getElementById('anomalyLoading');if(wrap){wrap.classList.toggle('hidden',!loading);wrap.textContent=msg;}}
function renderAnomalySummary(){const v=ANOMALY_STATE.summary;if(!v)return;const cards=[["Total Warning",v.total],["High",v.high],["Medium",v.medium],["Low",v.low],...Object.entries(v.byCategory||{}).filter(([,count])=>count>0).map(([key,count])=>[ANOMALY_STATE.categories[key]||key,count])];anomalySummary.innerHTML=cards.map(([label,count])=>`<div class='metric'><div class='k'>${esc(label)}</div><div class='v'>${Number(count).toLocaleString('id-ID')}</div></div>`).join('');}
function updateAnomalyTypeOptions(){if(!anomalyType)return;anomalyType.innerHTML='<option value="all">Semua Kategori</option>'+Object.entries(ANOMALY_STATE.categories).map(([key,label])=>`<option value="${esc(key)}">${esc(label)}</option>`).join('');anomalyType.value=ANOMALY_STATE.category;}
function renderAnomalyRowsOnly(){const tbody=document.querySelector('#anomalyTable tbody');if(tbody)tbody.innerHTML=ANOMALY_STATE.rows.map(r=>`<tr><td><span class='badge ${sevClass(r.severity)}'>${esc(r.severity)}</span></td><td>${esc(r.categoryLabel)}</td><td><strong>${esc(r.sku)}</strong></td><td>${esc(r.namaBarang)}</td><td>${esc(r.issue)}</td><td>${esc(r.source)}</td><td>${esc(r.evidence)}</td><td>${esc(r.recommendation)}</td><td><button class='btn-ghost' onclick="openWarningDetail('${encAttr(r.id)}')">Detail</button></td></tr>`).join('')||"<tr><td colspan='9'><div class='state'>Tidak ada data warning</div></td></tr>";const info=document.getElementById('anomalyInfo');if(info)info.textContent=`Halaman ${ANOMALY_STATE.page} • ${ANOMALY_STATE.rows.length} dari ${ANOMALY_STATE.total.toLocaleString('id-ID')} warning`;renderAnomalySummary();}
async function loadWarningPage({preserveScroll=false,throwOnError=false}={}){const token=++ANOMALY_STATE.lastRenderToken,wrap=document.querySelector('.anomaly-table-wrap'),top=wrap?.scrollTop||0,left=wrap?.scrollLeft||0;setAnomalyLoading(true);try{const headers=await getAuthHeaders(),response=await fetch(`/api/inventory-warnings?${warningQuery()}`,{headers,cache:'no-store'}),payload=await response.json().catch(()=>({}));if(!response.ok||!payload.success||!Array.isArray(payload.rows)){const sources=Array.isArray(payload.unavailableSources)&&payload.unavailableSources.length?` Source tidak tersedia: ${payload.unavailableSources.join(', ')}.`:'';throw new Error(`${payload.message||`HTTP ${response.status}`}${sources}`);}if(token!==ANOMALY_STATE.lastRenderToken)return;Object.assign(ANOMALY_STATE,{rows:payload.rows,total:payload.total,summary:payload.summary,categories:payload.categories||{}});updateAnomalyTypeOptions();renderAnomalyRowsOnly();if(preserveScroll&&wrap)requestAnimationFrame(()=>{wrap.scrollTop=top;wrap.scrollLeft=left;});if(payload.partial)toast(`Sebagian kategori tidak tersedia: ${(payload.unavailableSources||[]).join(', ')}`,'warning');}catch(error){if(token===ANOMALY_STATE.lastRenderToken){console.error('[WarningRefresh]',error?.message||error);setAnomalyLoading(true,error?.message||'Gagal memperbarui warning dari server');toast(error?.message||'Gagal memperbarui warning dari server','error');}if(throwOnError)throw error;}finally{if(token===ANOMALY_STATE.lastRenderToken&&!document.getElementById('anomalyLoading')?.textContent?.startsWith('Gagal'))setAnomalyLoading(false);}}
function scheduleAnomalySearch(value=''){ANOMALY_STATE.q=value;clearTimeout(ANOMALY_STATE._searchDebounce);ANOMALY_STATE._searchDebounce=setTimeout(()=>{ANOMALY_STATE.page=1;loadWarningPage();},350);}
function applyAnomalyFilters(resetPage=false){if(resetPage)ANOMALY_STATE.page=1;ANOMALY_STATE.severity=anomalySeverity?.value||'all';ANOMALY_STATE.category=anomalyType?.value||'all';ANOMALY_STATE.source=document.getElementById('anomalySource')?.value||'all';ANOMALY_STATE.sort=document.getElementById('anomalySort')?.value||'severity';loadWarningPage();}
function renderAnomalyPage(){if(!ANOMALY_STATE.rendered){anomalyTable.innerHTML=`<div class='row anomaly-toolbar'><div id='anomalyInfo' class='mv-pagination-info'>Memuat...</div><div class='row'><select id='anomalySort'><option value='severity'>Severity</option><option value='sku'>SKU A-Z</option><option value='name'>Nama A-Z</option><option value='category'>Kategori</option><option value='newest'>Event terbaru</option></select><select id='anomalySize'><option value='25'>25</option><option value='50'>50</option><option value='100'>100</option></select><button class='btn-ghost' onclick='changeAnomalyPage(-1)'>Prev</button><button class='btn-ghost' onclick='changeAnomalyPage(1)'>Next</button></div></div><div id='anomalyLoading' class='state'>Memuat warning...</div><div class='table-wrap table-wrap-full anomaly-table-wrap'><table><thead><tr><th>Severity</th><th>Category</th><th>SKU</th><th>Nama Barang</th><th>Masalah</th><th>Source</th><th>Evidence</th><th>Rekomendasi</th><th>Action</th></tr></thead><tbody></tbody></table></div>`;document.getElementById('anomalySize').value=String(ANOMALY_STATE.pageSize);document.getElementById('anomalySize').onchange=e=>{ANOMALY_STATE.pageSize=Number(e.target.value)||25;ANOMALY_STATE.page=1;loadWarningPage();};document.getElementById('anomalySort').onchange=()=>applyAnomalyFilters(true);document.getElementById('anomalySource').onchange=()=>applyAnomalyFilters(true);ANOMALY_STATE.rendered=true;}loadWarningPage();}
function refreshAnomalyInBackground(){return loadWarningPage({preserveScroll:true});}
function changeAnomalyPage(step){const max=Math.max(1,Math.ceil(ANOMALY_STATE.total/ANOMALY_STATE.pageSize)),next=Math.min(max,Math.max(1,ANOMALY_STATE.page+step));if(next!==ANOMALY_STATE.page){ANOMALY_STATE.page=next;loadWarningPage();}}
function openWarningDetail(id){const row=ANOMALY_STATE.rows.find(item=>item.id===decodeURIComponent(id));if(row?.sku&&row.sku!=='-')navigateToSku(row.sku);}
window.renderAnomalyPage=renderAnomalyPage;window.changeAnomalyPage=changeAnomalyPage;window.applyAnomalyFilters=applyAnomalyFilters;window.scheduleAnomalySearch=scheduleAnomalySearch;window.openWarningDetail=openWarningDetail;


const CYCLE_KEY="cycle_count_history_v3";
const CYCLE_STATE={sessionActive:false,tanggal:"",searchInput:"",search:"",searchTimer:null,sessionItems:[],submitting:false};
let cycleHistoryPage=1;
let cycleHistoryPageSize=10;
let CYCLE_HISTORY_REMOTE={rows:[],total:0,page:1,limit:10,status:"idle",error:"",requestId:0};
const HISTORY_EDIT_STATE={cycle:{},movement:{}};
async function loadCycleCountHistory({force=false}={}){
  if(CYCLE_HISTORY_REMOTE.status==="loading"&&!force)return;
  const requestId=++CYCLE_HISTORY_REMOTE.requestId;
  CYCLE_HISTORY_REMOTE={...CYCLE_HISTORY_REMOTE,status:"loading",error:"",requestId,page:cycleHistoryPage,limit:cycleHistoryPageSize};
  renderCycleHistory();
  try{
    const headers=await getAuthHeaders();
    const res=await fetch(`/api/cycle-count?page=${cycleHistoryPage}&limit=${cycleHistoryPageSize}`,{headers});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data?.message||`HTTP ${res.status}`);
    if(!Array.isArray(data?.rows)||!Number.isFinite(Number(data?.total)))throw new Error("Response history cycle count tidak valid");
    if(requestId!==CYCLE_HISTORY_REMOTE.requestId)return;
    CYCLE_HISTORY_REMOTE={rows:data.rows.map(r=>({...r,nama:r.nama_barang??r.nama??""})),total:Number(data.total),page:Number(data.page)||cycleHistoryPage,limit:Number(data.limit)||cycleHistoryPageSize,status:"success",error:"",requestId};
  }catch(err){
    if(requestId!==CYCLE_HISTORY_REMOTE.requestId)return;
    CYCLE_HISTORY_REMOTE={...CYCLE_HISTORY_REMOTE,rows:[],total:0,status:"error",error:err?.message||"Gagal memuat history cycle count",requestId};
  }
  renderCycleHistory();
}
function ensureCycleHistoryLoaded(){
  const samePage=CYCLE_HISTORY_REMOTE.page===cycleHistoryPage&&CYCLE_HISTORY_REMOTE.limit===cycleHistoryPageSize;
  if(CYCLE_HISTORY_REMOTE.status==="success"&&samePage)return Promise.resolve();
  return loadCycleCountHistory();
}
function retryCycleCountHistory(){return loadCycleCountHistory({force:true});}
function getQty(item){const qtySystem=Number(item?.stok_akhir??item?.stokAkhir??item?.qty??item?.availableQty??0);return Number.isFinite(qtySystem)?qtySystem:0;}
function getCycleSourceRows(){return (DATA["Kartu Stock"]||[]).map(r=>{const sku=String(getVal(r,["sku"])||"").trim();const nama=String(getVal(r,["nama barang","nama","item","description"])||"-").trim()||"-";const lokasi=String(getVal(r,["lokasi","location","rak","bin","area"])||"-").trim()||"-";const stok_akhir=getQty({stok_akhir:getVal(r,["stok akhir","stok_akhir","closing stock","ending stock","saldo akhir"]),stokAkhir:getVal(r,["stokAkhir"]),qty:getVal(r,["qty"]),availableQty:getVal(r,["availableQty"])});return {sku,nama,lokasi,stok_akhir};}).filter(r=>r.sku&&Number(r.stok_akhir)!==0);}
function getCycleCandidates(query){const q=clean(query);if(!q)return[];return getCycleSourceRows().filter(r=>clean(`${r.sku} ${r.nama} ${r.lokasi}`).includes(q)).slice(0,40);}
function cycleItemKey(item){return `${clean(item.sku)}__${clean(item.lokasi)}`;}
function cycleDiffBadge(item){const diff=(Number(item.aktual)-Number(item.stok));return diff===0?"<span class='badge b-ok'>Sesuai</span>":"<span class='badge b-warn'>Ada Selisih</span>";}
function formatTanggal(date){const d=new Date(date);const day=String(d.getDate()).padStart(2,"0");const month=String(d.getMonth()+1).padStart(2,"0");const year=d.getFullYear();return `${day}/${month}/${year}`;}
function formatInputDate(date){const d=new Date(date);const month=String(d.getMonth()+1).padStart(2,"0");const day=String(d.getDate()).padStart(2,"0");return `${d.getFullYear()}-${month}-${day}`;}
function canSubmitCycle(){return CYCLE_STATE.sessionItems.length>0&&CYCLE_STATE.sessionItems.every(it=>Number.isFinite(it.aktual));}
function buildCycleHistoryRows(){return [...(CYCLE_HISTORY_REMOTE.rows||[])];}
function renderCycleHistory(){const tbody=document.querySelector('#ccHistoryBody');if(!tbody)return;const info=document.getElementById('ccHistoryInfo');const prev=document.getElementById('ccHistoryPrev');const next=document.getElementById('ccHistoryNext');const sizeSel=document.getElementById('ccHistoryPageSize');const rows=buildCycleHistoryRows();const total=CYCLE_HISTORY_REMOTE.total||0;const start=(cycleHistoryPage-1)*cycleHistoryPageSize;const totalPages=Math.max(1,Math.ceil(total/cycleHistoryPageSize));if(sizeSel)sizeSel.value=String(cycleHistoryPageSize);if(info)info.textContent=`Menampilkan ${total?start+1:0}-${Math.min(start+rows.length,total)} dari ${total} data`;if(prev)prev.disabled=CYCLE_HISTORY_REMOTE.status==="loading"||cycleHistoryPage<=1;if(next)next.disabled=CYCLE_HISTORY_REMOTE.status==="loading"||cycleHistoryPage>=totalPages;if(CYCLE_HISTORY_REMOTE.status==="loading"||CYCLE_HISTORY_REMOTE.status==="idle"){tbody.innerHTML="<tr><td colspan='10'><div class='state'>Memuat history cycle count...</div></td></tr>";return;}if(CYCLE_HISTORY_REMOTE.status==="error"){tbody.innerHTML=`<tr><td colspan='10'><div class='state cc-history-error'><strong>Gagal memuat history cycle count</strong><span>${esc(CYCLE_HISTORY_REMOTE.error)}</span><button class='btn-ghost' type='button' data-cc-history-retry>Coba Lagi</button></div></td></tr>`;return;}if(!total){tbody.innerHTML="<tr><td colspan='10'><div class='state'>Belum ada history cycle count.</div></td></tr>";return;}const frag=document.createDocumentFragment();rows.forEach(r=>{const edit=HISTORY_EDIT_STATE.cycle[r.rowNumber];const tr=document.createElement('tr');const row=edit||r;const diff=(Number(row.aktual)-Number(row.stok))||0;if(edit){tr.innerHTML=`<td><input data-cch-edit='tanggal' data-row='${r.rowNumber}' value='${esc(edit.tanggal||"")}'></td><td><input data-cch-edit='lokasi' data-row='${r.rowNumber}' value='${esc(edit.lokasi||"")}'></td><td><input data-cch-edit='sku' data-row='${r.rowNumber}' value='${esc(edit.sku||"")}'></td><td><input data-cch-edit='nama' data-row='${r.rowNumber}' value='${esc(edit.nama||"")}'></td><td><input type='number' data-cch-edit='stok' data-row='${r.rowNumber}' value='${esc(edit.stok)}'></td><td><input type='number' data-cch-edit='aktual' data-row='${r.rowNumber}' value='${esc(edit.aktual)}'></td><td>${diff}</td><td><input data-cch-edit='catatan' data-row='${r.rowNumber}' value='${esc(edit.catatan||"")}'></td><td>${cycleDiffBadge(edit)}</td><td><button class='btn-ghost' data-cch-action='save' data-row='${r.rowNumber}'>Simpan</button> <button class='btn-ghost' data-cch-action='cancel' data-row='${r.rowNumber}'>Batal</button></td>`;}else{tr.innerHTML=`<td class='editable-cell' data-cch-field='tanggal' data-row='${r.rowNumber}'>${esc(r.tanggal||"-")}</td><td class='editable-cell' data-cch-field='lokasi' data-row='${r.rowNumber}'>${esc(r.lokasi)}</td><td class='editable-cell' data-cch-field='sku' data-row='${r.rowNumber}'>${esc(r.sku)}</td><td class='editable-cell' data-cch-field='nama' data-row='${r.rowNumber}'>${esc(r.nama)}</td><td class='editable-cell' data-cch-field='stok' data-row='${r.rowNumber}'>${r.stok}</td><td class='editable-cell' data-cch-field='aktual' data-row='${r.rowNumber}'>${r.aktual}</td><td>${diff}</td><td class='editable-cell' data-cch-field='catatan' data-row='${r.rowNumber}'>${esc(r.catatan||"-")}</td><td>${cycleDiffBadge(r)}</td><td><button class='icon-btn danger' title='Hapus' aria-label='Hapus data' data-cch-action='delete' data-row='${r.rowNumber}'><i data-lucide='trash-2'></i></button></td>`;}frag.appendChild(tr);});tbody.replaceChildren(frag);if(window.lucide&&typeof window.lucide.createIcons==='function')window.lucide.createIcons();}
function renderCycleSearchResults(){const tbody=document.querySelector('#ccSearchResultsBody');if(!tbody)return;const candidates=CYCLE_STATE.sessionActive?getCycleCandidates(CYCLE_STATE.search):[];if(!candidates.length){tbody.innerHTML="<tr><td colspan='5'><div class='state cc-state'>Cari SKU untuk menambah item.</div></td></tr>";return;}const frag=document.createDocumentFragment();candidates.forEach(c=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(c.lokasi)}</td><td>${esc(c.sku)}</td><td>${esc(c.nama)}</td><td>${esc(c.stok_akhir)}</td><td><button class='btn-ghost' data-cc-action='add' data-sku='${encAttr(c.sku)}' data-lok='${encAttr(c.lokasi)}'>Tambah</button></td>`;frag.appendChild(tr);});tbody.replaceChildren(frag);}
function renderCycleSessionTable(){const tbody=document.querySelector('#ccSessionBody');if(!tbody)return;const submitBtn=document.getElementById('ccSubmitBtn');if(submitBtn){submitBtn.disabled=!canSubmitCycle()||CYCLE_STATE.submitting;submitBtn.textContent=CYCLE_STATE.submitting?"Menyimpan...":"Selesai Cycle Count";}if(!CYCLE_STATE.sessionItems.length){tbody.innerHTML="<tr><td colspan='9'><div class='state cc-state'>Belum ada item dalam session.</div></td></tr>";return;}const frag=document.createDocumentFragment();CYCLE_STATE.sessionItems.forEach((r,i)=>{const diff=(Number(r.aktual)-Number(r.stok))||0;const tr=document.createElement('tr');tr.dataset.idx=String(i);tr.innerHTML=`<td>${esc(r.lokasi)}</td><td>${esc(r.sku)}</td><td>${esc(r.nama)}</td><td>${r.stok}</td><td><input type='number' data-cc='aktual' data-idx='${i}' value='${r.aktual??""}'></td><td><input data-cc='ct' data-idx='${i}' value='${esc(r.catatan||"")}'></td><td data-cc-cell='diff'>${diff}</td><td data-cc-cell='st'>${cycleDiffBadge(r)}</td><td><button class='btn-ghost' data-cc-action='remove' data-idx='${i}'>Hapus</button></td>`;frag.appendChild(tr);});tbody.replaceChildren(frag);}
function renderCycleCountPage(){if(!cycleCountApp)return;cycleCountApp.innerHTML=`<div class='card cc-card cc-section'><div class='section-header cc-main-header'><div class='cc-action-stack'>${CYCLE_STATE.sessionActive?"<button class='btn-ghost' onclick='ccCancelSession()'>Batal Cycle Count</button>":""}<button class='btn-primary' onclick='ccStartSession()' ${(!getPermissions().canCreate||CYCLE_STATE.sessionActive)?"disabled":""}>Mulai Cycle Count</button>${CYCLE_STATE.sessionActive?"<button id='ccSubmitBtn' class='btn-primary' onclick='ccSubmitSession()'>Selesai Cycle Count</button>":""}</div></div>${CYCLE_STATE.sessionActive?`<div class='cc-section'><div class='cc-filter-row'><label><span>Tanggal</span><input id='ccTanggal' type='date' class='search-lg' value='${esc(CYCLE_STATE.tanggal||formatInputDate(new Date()))}'></label><label><span>Cari SKU / nama barang / lokasi</span><input id='ccSearch' class='search-lg' placeholder='Cari SKU / nama barang / lokasi' value='${esc(CYCLE_STATE.searchInput)}'></label></div></div><div class='cc-section'><div class='table-wrap cc-table-wrap cc-search-wrap'><table><thead><tr><th>Lokasi</th><th>SKU</th><th>Nama Barang</th><th>STOK</th><th>Aksi</th></tr></thead><tbody id='ccSearchResultsBody'></tbody></table></div></div><div class='cc-section'><h4>Cycle Count Berjalan</h4><div class='table-wrap cc-table-wrap cc-session-wrap'><table><thead><tr><th>Lokasi</th><th>SKU</th><th>Nama Barang</th><th>STOK</th><th>Aktual</th><th>Catatan</th><th>Selisih</th><th>Status</th><th>Aksi</th></tr></thead><tbody id='ccSessionBody'></tbody></table></div></div>`:`<div class='cc-empty-state'><i data-lucide='clipboard-check'></i><h4>Belum ada cycle count berjalan</h4><p>Klik Mulai Cycle Count untuk memilih SKU dan input stok aktual.</p></div>`}</div><div class='card cc-card cc-section'><div class='section-header'><h4>History Cycle Count</h4></div><div class='table-wrap cc-table-wrap'><table><thead><tr><th>Tanggal</th><th>Lokasi</th><th>SKU</th><th>Nama Barang</th><th>STOK</th><th>Aktual</th><th>Selisih</th><th>Catatan</th><th>Status</th><th>Aksi</th></tr></thead><tbody id='ccHistoryBody'></tbody></table></div><div class='mv-pagination'><span id='ccHistoryInfo'>Menampilkan 0-0 dari 0 data</span><div class='row'><select id='ccHistoryPageSize'><option value='10'>10</option><option value='25'>25</option><option value='50'>50</option></select><button id='ccHistoryPrev' class='btn-ghost'>Prev</button><button id='ccHistoryNext' class='btn-ghost'>Next</button></div></div></div>`;if(window.lucide&&typeof window.lucide.createIcons==="function")window.lucide.createIcons();if(CYCLE_STATE.sessionActive){renderCycleSearchResults();renderCycleSessionTable();}renderCycleHistory();ensureCycleHistoryLoaded();}
window.ccStartSession=()=>{CYCLE_STATE.sessionActive=true;CYCLE_STATE.tanggal=formatInputDate(new Date());CYCLE_STATE.search="";CYCLE_STATE.searchInput="";CYCLE_STATE.sessionItems=[];renderCycleCountPage();};
window.ccCancelSession=()=>{showConfirmModal({title:'Batal Cycle Count',message:'Batalkan cycle count yang sedang berjalan?',confirmText:'Ya, Batalkan',cancelText:'Kembali',type:'danger',onConfirm:()=>{CYCLE_STATE.sessionActive=false;CYCLE_STATE.tanggal="";CYCLE_STATE.search="";CYCLE_STATE.searchInput="";CYCLE_STATE.sessionItems=[];CYCLE_STATE.submitting=false;renderCycleCountPage();}});};
function addCycleItem(source){const qtySystem=getQty(source);const newItem={...source,stok:qtySystem,aktual:null,catatan:""};const key=cycleItemKey(newItem);if(CYCLE_STATE.sessionItems.some(it=>cycleItemKey(it)===key)){toast('SKU/lokasi sudah ada di session.','error');return;}CYCLE_STATE.sessionItems.push(newItem);renderCycleSessionTable();toast('Item ditambahkan','success');}
window.ccAddItem=(skuEnc,lokEnc)=>{const sku=decodeURIComponent(skuEnc),lokasi=decodeURIComponent(lokEnc);const source=getCycleSourceRows().find(r=>clean(r.sku)===clean(sku)&&clean(r.lokasi)===clean(lokasi));if(!source)return;addCycleItem(source);};
window.ccRemoveItem=(idx)=>{CYCLE_STATE.sessionItems.splice(idx,1);renderCycleSessionTable();};
window.ccSubmitSession=async()=>{if(!canSubmitCycle()){toast('Lengkapi Aktual semua item.','error');return;}CYCLE_STATE.submitting=true;renderCycleSessionTable();try{const tanggal=CYCLE_STATE.tanggal?formatTanggal(CYCLE_STATE.tanggal):formatTanggal(new Date());const payload={tanggal,items:CYCLE_STATE.sessionItems.map(it=>({lokasi:it.lokasi,sku:it.sku,nama_barang:it.nama,stok:Number(it.stok)||0,aktual:Number(it.aktual),catatan:it.catatan||""}))};const res=await fetch('/api/cycle-count',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await res.json();if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal menyimpan cycle count');toast('Cycle count berhasil disimpan','success');logActivitySafe({action:'SUBMIT_CYCLE_COUNT',module:'Cycle Count',detail:`Submit cycle count ${payload.items.length} item`,status:'SUCCESS',metadata:{items:payload.items.length}});CYCLE_STATE.sessionActive=false;CYCLE_STATE.tanggal="";CYCLE_STATE.searchInput="";CYCLE_STATE.search="";CYCLE_STATE.sessionItems=[];await loadCycleCountHistory({force:true});if(typeof syncData==='function')syncData();}catch(err){toast(err?.message||'Gagal menyimpan cycle count','error');}finally{CYCLE_STATE.submitting=false;renderCycleCountPage();}};

async function updateHistoryCell(type,module,rowData,field,newValue,oldValue){const wrapper=type==='movement'?document.querySelector('#mvHistoryBody')?.closest('.table-wrap'):document.querySelector('#ccHistoryBody')?.closest('.table-wrap');const scrollTop=wrapper?.scrollTop||0;const scrollLeft=wrapper?.scrollLeft||0;const url=type==='movement'?'/api/movement/cell':'/api/cycle-count/cell';const rowNumber=Number(rowData?.rowNumber);const movementFieldMap={nama:'namaBarang',stok_lokasi_awal:'stokDiLokasiAwal',stok_aktual:'stokAktual'};const apiField=type==='movement'?(movementFieldMap[field]||field):field;const res=await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({rowNumber,field:apiField,value:newValue})});const data=await res.json();if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal update data');if(type==='movement'){const target=(MOVEMENT_HISTORY_REMOTE.rows||[]).find(r=>Number(r.rowNumber)===rowNumber);if(target)target[field]=newValue;renderMovementHistory();}else{const target=(CYCLE_HISTORY_REMOTE.rows||[]).find(r=>Number(r.rowNumber)===rowNumber);if(target)target[field]=newValue;renderCycleHistory();}await new Promise(resolve=>requestAnimationFrame(resolve));const nextWrapper=type==='movement'?document.querySelector('#mvHistoryBody')?.closest('.table-wrap'):document.querySelector('#ccHistoryBody')?.closest('.table-wrap');if(nextWrapper){nextWrapper.scrollTop=scrollTop;nextWrapper.scrollLeft=scrollLeft;}toast(`${module} berhasil diupdate`,'success');logActivitySafe({action:type==='movement'?'EDIT_MOVEMENT':'EDIT_CYCLE_COUNT',module,detail:`[EDIT] ${field}
SKU: ${rowData?.sku||'-'}
${oldValue||'-'} → ${newValue||'-'}`,status:'SUCCESS',metadata:{rowNumber,sku:rowData?.sku||'',field,oldValue,newValue}});} 
document.addEventListener('input',e=>{if(e.target?.id==='ccTanggal'){CYCLE_STATE.tanggal=e.target.value||'';return;}if(e.target?.id==='ccSearch'){CYCLE_STATE.searchInput=e.target.value;cycleHistoryPage=1;clearTimeout(CYCLE_STATE.searchTimer);CYCLE_STATE.searchTimer=setTimeout(()=>{CYCLE_STATE.search=CYCLE_STATE.searchInput;renderCycleSearchResults();},280);return;}if(e.target?.id==='ccHistoryPageSize'){cycleHistoryPageSize=Number(e.target.value)||10;cycleHistoryPage=1;loadCycleCountHistory({force:true});return;}if(e.target?.dataset?.cc){const idx=Number(e.target.dataset.idx);const row=CYCLE_STATE.sessionItems[idx];if(!row)return;if(e.target.dataset.cc==='aktual'){const n=Number(e.target.value);row.aktual=Number.isFinite(n)?n:null;}if(e.target.dataset.cc==='ct')row.catatan=e.target.value||"";const tr=e.target.closest('tr');if(tr){const diff=(Number(row.aktual)-Number(row.stok))||0;const diffCell=tr.querySelector("[data-cc-cell='diff']"),stCell=tr.querySelector("[data-cc-cell='st']");if(diffCell)diffCell.textContent=String(diff);if(stCell)stCell.innerHTML=cycleDiffBadge(row);}const submitBtn=document.getElementById('ccSubmitBtn');if(submitBtn)submitBtn.disabled=!canSubmitCycle()||CYCLE_STATE.submitting;}});
document.addEventListener('click',e=>{const btn=e.target?.closest('[data-cc-action]');if(!btn)return;if(btn.dataset.ccAction==='add')ccAddItem(btn.dataset.sku||"",btn.dataset.lok||"");if(btn.dataset.ccAction==='remove')ccRemoveItem(Number(btn.dataset.idx));});



const ARCHIVE_SOURCES=[
  {key:"inventory",name:"Inventory",spreadsheetId:SPREADSHEET_ID},
  {key:"kartu-stok-2025",name:"Kartu Stok 2025",spreadsheetId:"1D2El94SfeNglcEuBNqetVoCEROsINaMjvL6E85Ng7KU"}
];
const ARCHIVE_STATE={sheetList:[],selectedSpreadsheetKey:"",selectedSheet:"",cache:{},loadingList:false,loadingData:false,refreshing:false,listError:"",dataError:"",searchInput:"",search:"",searchTimer:null,searchToken:0,minSearchLength:2,sortColumn:"",sortDirection:"asc",columnFilter:"all",columnFilters:{},openFilterColumn:"",filterOptionCache:{},filterSearchDraft:{},page:1,pageSize:25,lastLoadedAt:{}};
function getArchiveSourceByKey(key){return ARCHIVE_SOURCES.find(src=>src.key===key)||null;}
function getArchiveActiveSource(){return getArchiveSourceByKey(ARCHIVE_STATE.selectedSpreadsheetKey);}
function buildArchiveCacheKey(spreadsheetId,sheetName){return `${spreadsheetId}::${sheetName}`;}

function bindArchiveEvents(){document.addEventListener("change",e=>{if(e.target?.id==="archiveSpreadsheetSelect"){selectArchiveSpreadsheet(e.target.value);return;}if(e.target?.id==="archiveSheetSelect")selectArchiveSheet(e.target.value);if(e.target?.id==="archiveSortColumn"){ARCHIVE_STATE.sortColumn=e.target.value;ARCHIVE_STATE.page=1;renderArchivePage();}if(e.target?.id==="archiveSortDir"){ARCHIVE_STATE.sortDirection=e.target.value;ARCHIVE_STATE.page=1;renderArchivePage();}if(e.target?.id==="archiveColumnFilter"){ARCHIVE_STATE.columnFilter=e.target.value;ARCHIVE_STATE.page=1;renderArchivePage();}if(e.target?.matches("[data-archive-filter-value]")){updateArchiveValueFilter(e.target.dataset.archiveFilterColumn,e.target.dataset.archiveFilterValue||"",e.target.checked,e.target.hasAttribute("data-archive-filter-empty"));return;}if(e.target?.matches("[data-archive-page-size]")){ARCHIVE_STATE.pageSize=Number(e.target.value)||25;ARCHIVE_STATE.page=1;renderArchiveTableOnly();}});document.addEventListener("input",e=>{if(e.target?.matches("[data-archive-filter-search]")){const raw=String(e.target.value||"");ARCHIVE_STATE.filterSearchDraft[e.target.dataset.archiveFilterSearch]=raw;const query=raw.trim().toLocaleLowerCase("id");e.target.closest("[data-archive-filter-menu]")?.querySelectorAll("[data-archive-filter-item]").forEach(option=>{option.hidden=!!query&&!String(option.textContent||"").toLocaleLowerCase("id").includes(query);});return;}if(e.target?.id!=="archiveSearch")return;ARCHIVE_STATE.searchInput=e.target.value||"";const debounceToken=++ARCHIVE_STATE.searchToken;clearTimeout(ARCHIVE_STATE.searchTimer);ARCHIVE_STATE.searchTimer=setTimeout(()=>{if(debounceToken!==ARCHIVE_STATE.searchToken)return;const rawInput=String(ARCHIVE_STATE.searchInput||"").trim();ARCHIVE_STATE.search=rawInput.length>=ARCHIVE_STATE.minSearchLength?rawInput:"";ARCHIVE_STATE.page=1;renderArchiveTableOnly();},380);});document.addEventListener("keydown",e=>{if(e.key!=="Enter"||!e.target?.matches("[data-archive-filter-search]"))return;e.preventDefault();applyArchiveContainsFilter(e.target.dataset.archiveFilterSearch,e.target.value);});document.addEventListener("click",e=>{if(e.target?.closest("#archiveRefreshBtn"))refreshArchive();const pg=e.target?.closest("[data-archive-page]");if(pg){ARCHIVE_STATE.page=Math.max(1,ARCHIVE_STATE.page+(Number(pg.dataset.archivePage)||0));renderArchiveTableOnly();return;}const toggle=e.target?.closest("[data-archive-filter-toggle]");if(toggle){toggleArchiveFilter(toggle.dataset.archiveFilterToggle,toggle);return;}const option=e.target?.closest("[data-archive-filter-option]");if(option){setArchiveColumnFilter(option.dataset.archiveFilterColumn,option.dataset.archiveFilterOption,option.dataset.archiveFilterValue||"");return;}const apply=e.target?.closest("[data-archive-filter-apply]");if(apply){const input=document.querySelector(`[data-archive-filter-search="${CSS.escape(apply.dataset.archiveFilterApply)}"]`);applyArchiveContainsFilter(apply.dataset.archiveFilterApply,input?.value||"");return;}const reset=e.target?.closest("[data-archive-filter-reset]");if(reset){resetArchiveColumnFilter(reset.dataset.archiveFilterReset);return;}if(e.target?.closest("[data-archive-reset-all]")){ARCHIVE_STATE.columnFilters={};ARCHIVE_STATE.openFilterColumn="";ARCHIVE_STATE.page=1;renderArchiveTableOnly();return;}if(!e.target?.closest("[data-archive-filter-menu]")){ARCHIVE_STATE.openFilterColumn="";document.querySelectorAll("[data-archive-filter-menu]").forEach(m=>m.hidden=true);}});}
function normalizeArchiveCell(value){return String(value??"").trim();}
function parseArchiveSheetFlexible(values){
if(!Array.isArray(values)||!values.length)return {rows:[],columns:[],headerError:false};
let headerIndex=-1,bestFilled=0;
for(let i=0;i<values.length;i++){
const filled=(values[i]||[]).reduce((n,cell)=>n+(normalizeArchiveCell(cell)?1:0),0);
if(filled>bestFilled){bestFilled=filled;headerIndex=i;}
}
if(headerIndex<0||bestFilled<=0)return {rows:[],columns:[],headerError:true};
const headerRow=values[headerIndex]||[];
const colCount=Math.max(...values.map(r=>(r||[]).length),headerRow.length);
const columns=Array.from({length:colCount},(_,i)=>normalizeArchiveCell(headerRow[i])||`Kolom ${i+1}`);
const rows=[];
for(let r=headerIndex+1;r<values.length;r++){
const row=values[r]||[];
const isEmpty=!row.length||row.every(c=>!normalizeArchiveCell(c));
if(isEmpty)continue;
const obj={};
for(let c=0;c<columns.length;c++)obj[columns[c]]=normalizeArchiveCell(row[c]||"");
rows.push(obj);
}
return {rows,columns,headerError:false};
}
async function fetchArchiveSheetList(spreadsheetId){
const url=`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title&key=${API_KEY}`;
const res=await fetch(url);
const json=await res.json();
if(!res.ok||json.error)throw new Error((json.error&&json.error.message)||res.statusText||"Gagal memuat daftar sheet");
return (json.sheets||[]).map(s=>String(s?.properties?.title||"").trim()).filter(Boolean).map(name=>({key:name,name,spreadsheetId}));
}
async function fetchArchiveSheetData(spreadsheetId,sheetKey,sheetList=ARCHIVE_STATE.sheetList){
const selected=(sheetList||[]).find(s=>s.key===sheetKey);
if(!selected)throw new Error("Sheet arsip tidak valid");
const range=`${selected.name}!A1:ZZ`;
const url=`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
const res=await fetch(url);
const json=await res.json();
if(!res.ok||json.error) throw new Error(`${selected.name}: ${(json.error&&json.error.message)||res.statusText}`);
return parseArchiveSheetFlexible(json.values||[]);
}
async function ensureArchiveList(){const source=getArchiveActiveSource();if(!source){ARCHIVE_STATE.sheetList=[];ARCHIVE_STATE.listError="";renderArchivePage();return;}if(ARCHIVE_STATE.sheetList.length||ARCHIVE_STATE.loadingList)return;ARCHIVE_STATE.loadingList=true;ARCHIVE_STATE.listError="";renderArchivePage();try{ARCHIVE_STATE.sheetList=await fetchArchiveSheetList(source.spreadsheetId);}catch(err){ARCHIVE_STATE.listError=err.message||"Gagal memuat daftar sheet";}finally{ARCHIVE_STATE.loadingList=false;renderArchivePage();}}
async function selectArchiveSpreadsheet(spreadsheetKey){ARCHIVE_STATE.selectedSpreadsheetKey=spreadsheetKey||"";ARCHIVE_STATE.selectedSheet="";ARCHIVE_STATE.sheetList=[];ARCHIVE_STATE.columnFilters={};ARCHIVE_STATE.openFilterColumn="";ARCHIVE_STATE.page=1;ARCHIVE_STATE.dataError="";ARCHIVE_STATE.listError="";if(!spreadsheetKey){renderArchivePage();return;}await ensureArchiveList();}
async function selectArchiveSheet(sheetName){ARCHIVE_STATE.selectedSheet=sheetName||"";ARCHIVE_STATE.columnFilters={};ARCHIVE_STATE.openFilterColumn="";ARCHIVE_STATE.page=1;ARCHIVE_STATE.dataError="";const source=getArchiveActiveSource();if(!sheetName||!source){renderArchivePage();return;}const cacheKey=buildArchiveCacheKey(source.spreadsheetId,sheetName);if(ARCHIVE_STATE.cache[cacheKey]){renderArchivePage();return;}ARCHIVE_STATE.loadingData=true;renderArchivePage();try{ARCHIVE_STATE.cache[cacheKey]=await fetchArchiveSheetData(source.spreadsheetId,sheetName);ARCHIVE_STATE.lastLoadedAt[cacheKey]=new Date().toISOString();}catch(err){ARCHIVE_STATE.dataError=err.message||"Gagal memuat data sheet";}finally{ARCHIVE_STATE.loadingData=false;renderArchivePage();}}
async function refreshArchive(){const source=getArchiveActiveSource();const sheet=ARCHIVE_STATE.selectedSheet;if(!source)return;if(!sheet){ARCHIVE_STATE.sheetList=[];await ensureArchiveList();return;}const cacheKey=buildArchiveCacheKey(source.spreadsheetId,sheet);const hadData=!!ARCHIVE_STATE.cache[cacheKey];ARCHIVE_STATE.refreshing=true;ARCHIVE_STATE.loadingData=!hadData;ARCHIVE_STATE.dataError="";renderArchivePage();try{const fresh=await fetchArchiveSheetData(source.spreadsheetId,sheet);ARCHIVE_STATE.cache[cacheKey]=fresh;ARCHIVE_STATE.filterOptionCache={};ARCHIVE_STATE.lastLoadedAt[cacheKey]=new Date().toISOString();const valid=new Set(fresh.columns||[]);ARCHIVE_STATE.columnFilters=Object.fromEntries(Object.entries(ARCHIVE_STATE.columnFilters).filter(([key])=>valid.has(key)));}catch(err){ARCHIVE_STATE.dataError=err.message||"Gagal refresh data";}finally{ARCHIVE_STATE.loadingData=false;ARCHIVE_STATE.refreshing=false;renderArchivePage();}}

function isEmptyArchiveValue(value){return value==null||String(value).trim()==="";}
function archiveFilterIsActive(filter){return !!filter&&filter.mode!=="all"&&(filter.mode!=="values"||!!filter.includeEmpty||(filter.values||[]).length>0);}
function getArchiveUniqueValues(rows,column,cacheKey){const key=`${cacheKey}|${column}|${rows.length}`;if(ARCHIVE_STATE.filterOptionCache[key])return ARCHIVE_STATE.filterOptionCache[key];const values=[...new Set(rows.filter(r=>!isEmptyArchiveValue(r[column])).map(r=>String(r[column]).trim()))].sort((a,b)=>a.localeCompare(b,"id",{numeric:true}));ARCHIVE_STATE.filterOptionCache[key]=values;return values;}
function matchesArchiveColumnFilter(value,filter){if(!archiveFilterIsActive(filter))return true;if(filter.mode==="empty")return isEmptyArchiveValue(value);if(filter.mode==="values"){if(isEmptyArchiveValue(value))return !!filter.includeEmpty;const cell=String(value).trim().toLocaleLowerCase("id");return (filter.values||[]).some(selected=>String(selected).trim().toLocaleLowerCase("id")===cell);}if(isEmptyArchiveValue(value))return false;const cell=String(value).trim();if(filter.mode==="exact")return cell.toLocaleLowerCase("id")===String(filter.value).trim().toLocaleLowerCase("id");return cell.toLocaleLowerCase("id").includes(String(filter.value).trim().toLocaleLowerCase("id"));}
function setArchiveColumnFilter(column,mode,value=""){if(mode==="all")delete ARCHIVE_STATE.columnFilters[column];else ARCHIVE_STATE.columnFilters[column]={type:"auto",mode,value};ARCHIVE_STATE.openFilterColumn="";ARCHIVE_STATE.page=1;renderArchiveTableOnly();}
function applyArchiveContainsFilter(column,value){const query=String(value??"").trim();setArchiveColumnFilter(column,query?"contains":"all",query);}
function updateArchiveValueFilter(column,value,checked,isEmpty=false){const previous=ARCHIVE_STATE.columnFilters[column];const values=previous?.mode==="values"?[...(previous.values||[])]:[];let includeEmpty=previous?.mode==="values"&&!!previous.includeEmpty;if(isEmpty)includeEmpty=checked;else{const index=values.indexOf(value);if(checked&&index<0)values.push(value);if(!checked&&index>=0)values.splice(index,1);}if(values.length||includeEmpty)ARCHIVE_STATE.columnFilters[column]={type:"auto",mode:"values",values,includeEmpty};else delete ARCHIVE_STATE.columnFilters[column];ARCHIVE_STATE.page=1;renderArchiveTableOnly();requestAnimationFrame(()=>reopenArchiveFilter(column));}
function reopenArchiveFilter(column){const button=[...document.querySelectorAll("[data-archive-filter-toggle]")].find(item=>item.dataset.archiveFilterToggle===column);if(!button)return;toggleArchiveFilter(column,button);const input=button.parentElement?.querySelector("[data-archive-filter-search]");if(input){input.value=ARCHIVE_STATE.filterSearchDraft[column]||"";input.dispatchEvent(new Event("input",{bubbles:true}));}}
function resetArchiveColumnFilter(column){setArchiveColumnFilter(column,"all");}
function toggleArchiveFilter(column,button){const menu=button.parentElement?.querySelector("[data-archive-filter-menu]");if(!menu)return;const willOpen=menu.hidden;document.querySelectorAll("[data-archive-filter-menu]").forEach(item=>item.hidden=true);ARCHIVE_STATE.openFilterColumn=willOpen?column:"";menu.hidden=!willOpen;if(willOpen){const rect=button.getBoundingClientRect(),width=Math.min(260,window.innerWidth-16);menu.style.width=`${width}px`;menu.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-width-8))}px`;menu.style.top=`${Math.min(rect.bottom+6,window.innerHeight-menu.offsetHeight-8)}px`;menu.querySelector("input")?.focus();}}
function getArchiveRows(){const source=getArchiveActiveSource();const cacheKey=source&&ARCHIVE_STATE.selectedSheet?buildArchiveCacheKey(source.spreadsheetId,ARCHIVE_STATE.selectedSheet):"";const parsed=ARCHIVE_STATE.cache[cacheKey]||{rows:[],columns:[],headerError:false};const cols=parsed.columns||[];const valid=new Set(cols);for(const key of Object.keys(ARCHIVE_STATE.columnFilters))if(!valid.has(key))delete ARCHIVE_STATE.columnFilters[key];const q=clean(ARCHIVE_STATE.search);let out=(parsed.rows||[]).filter(r=>!q||cols.some(c=>clean(String(r[c]??"")).includes(q)));if(ARCHIVE_STATE.columnFilter!=="all"&&q)out=out.filter(r=>clean(String(r[ARCHIVE_STATE.columnFilter]??"")).includes(q));const filters=ARCHIVE_STATE.columnFilters;out=out.filter(row=>Object.entries(filters).every(([column,filter])=>matchesArchiveColumnFilter(row[column],filter)));const col=ARCHIVE_STATE.sortColumn||cols[0]||"";if(col)out=[...out].sort((a,b)=>{const av=a[col],bv=b[col];const an=Number(av),bn=Number(bv),numA=!isEmptyArchiveValue(av)&&Number.isFinite(an),numB=!isEmptyArchiveValue(bv)&&Number.isFinite(bn);let cmp=0;if(numA&&numB)cmp=an-bn;else cmp=String(av??"").localeCompare(String(bv??""),"id",{numeric:true});return ARCHIVE_STATE.sortDirection==="desc"?-cmp:cmp;});return {rows:out,columns:cols,headerError:!!parsed.headerError};}
function renderArchiveFilterHeader(column,sourceRows,cacheKey){const filter=ARCHIVE_STATE.columnFilters[column];const active=archiveFilterIsActive(filter);const values=getArchiveUniqueValues(sourceRows,column,cacheKey);const selectedValues=filter?.mode==="values"?(filter.values||[]):[];const includeEmpty=filter?.mode==="values"&&!!filter.includeEmpty;const currentSearch=filter?.mode==="contains"?filter.value:(ARCHIVE_STATE.filterSearchDraft[column]||"");return `<th><div class='th-filter-wrap archive-th-filter'><span>${esc(column)}</span><button type='button' class='th-filter-btn ${active?"active":""}' data-archive-filter-toggle='${esc(column)}' title='${active?"Filter aktif":"Filter "+esc(column)}' aria-label='Filter ${esc(column)}'><span class='th-filter-icon'>▾</span>${active?"<span class='archive-filter-dot' aria-hidden='true'></span>":""}</button><div class='th-filter-dropdown archive-filter-dropdown' data-archive-filter-menu hidden><input class='th-filter-search' data-archive-filter-search='${esc(column)}' value='${esc(currentSearch||"")}' placeholder='Cari nilai...' autocomplete='off'><div class='archive-filter-search-action'><button class='btn-ghost' type='button' data-archive-filter-apply='${esc(column)}'>Contains</button></div><div class='th-filter-actions'><button type='button' data-archive-filter-option='all' data-archive-filter-column='${esc(column)}'>Semua</button></div><div class='th-filter-options archive-filter-options'><label data-archive-filter-item class='archive-filter-option'><input type='checkbox' data-archive-filter-value data-archive-filter-empty data-archive-filter-column='${esc(column)}' ${includeEmpty?"checked":""}><span>(Kosong)</span></label>${values.map(value=>`<label data-archive-filter-item class='archive-filter-option' title='${esc(value)}'><input type='checkbox' data-archive-filter-value='${esc(value)}' data-archive-filter-column='${esc(column)}' ${selectedValues.includes(value)?"checked":""}><span>${esc(value)}</span></label>`).join("")}</div><div class='archive-filter-footer'><span>${selectedValues.length+(includeEmpty?1:0)} dipilih</span><button type='button' data-archive-filter-reset='${esc(column)}' ${active?"":"disabled"}>Reset</button></div></div></div></th>`;}
function getArchiveFilterLabel(column,filter){if(filter.mode==="empty")return `${column}: Kosong`;if(filter.mode==="contains")return `${column}: ${filter.value}`;if(filter.mode==="values"){const count=(filter.values||[]).length+(filter.includeEmpty?1:0);return `${column}: ${count} nilai`;}return `${column}: ${filter.value}`;}
function renderArchiveTableOnly(){const mount=document.getElementById("archiveDataSection");if(!mount)return;const source=getArchiveActiveSource();const selected=ARCHIVE_STATE.selectedSheet;const cacheKey=source&&selected?buildArchiveCacheKey(source.spreadsheetId,selected):"";const parsed=ARCHIVE_STATE.cache[cacheKey]||{rows:[],columns:[],headerError:false};const sourceRows=parsed.rows||[];const {rows,columns,headerError}=selected?getArchiveRows():{rows:[],columns:[],headerError:false};const totalPage=Math.max(1,Math.ceil(rows.length/ARCHIVE_STATE.pageSize));if(ARCHIVE_STATE.page>totalPage)ARCHIVE_STATE.page=totalPage;const start=(ARCHIVE_STATE.page-1)*ARCHIVE_STATE.pageSize;const pageRows=rows.slice(start,start+ARCHIVE_STATE.pageSize);const activeSheetName=(ARCHIVE_STATE.sheetList.find(s=>s.key===selected)||{}).name||selected||"-";const lastLoaded=cacheKey&&ARCHIVE_STATE.lastLoadedAt[cacheKey]?new Date(ARCHIVE_STATE.lastLoadedAt[cacheKey]).toLocaleString("id-ID"):"-";const colFilter=document.getElementById("archiveColumnFilter");if(colFilter){const current=ARCHIVE_STATE.columnFilter;colFilter.innerHTML=`<option value='all'>Semua Kolom</option>${columns.map(c=>`<option value='${esc(c)}'>Filter: ${esc(c)}</option>`).join("")}`;colFilter.value=columns.includes(current)||current==="all"?current:"all";ARCHIVE_STATE.columnFilter=colFilter.value||"all";}if(!source){mount.innerHTML="<div class='card archive-section'><div class='state'>Pilih spreadsheet untuk melihat data arsip</div></div>";return;}if(!selected){mount.innerHTML="<div class='card archive-section'><div class='state'>Pilih sheet arsip untuk melihat data</div></div>";return;}if(ARCHIVE_STATE.loadingData&&!sourceRows.length){mount.innerHTML="<div class='card archive-section'><div class='state'>Memuat data sheet...</div></div>";return;}if(ARCHIVE_STATE.dataError&&!sourceRows.length){mount.innerHTML=`<div class='card archive-section'><div class='state'>${esc(ARCHIVE_STATE.dataError)}</div></div>`;return;}if(headerError){mount.innerHTML="<div class='card archive-section'><div class='state'>Header tidak terdeteksi</div></div>";return;}const activeFilters=Object.entries(ARCHIVE_STATE.columnFilters).filter(([,filter])=>archiveFilterIsActive(filter));const filterSummary=activeFilters.length?`<div class='archive-active-filters'>${activeFilters.map(([column,filter])=>`<span class='archive-filter-chip'>${esc(getArchiveFilterLabel(column,filter))}<button type='button' data-archive-filter-reset='${esc(column)}' aria-label='Hapus filter ${esc(column)}'>×</button></span>`).join("")}<button class='btn-ghost archive-reset-filter' type='button' data-archive-reset-all>Reset Filter</button></div>`:"";const emptyMessage=activeFilters.length?"Tidak ada data Arsip yang cocok dengan filter.":"Tidak ada data";mount.innerHTML=`<div class='card archive-section'><div class='grid dashboard archive-summary'><div class='metric'><div class='k'>Total Baris</div><div class='v'>${sourceRows.length}</div></div><div class='metric'><div class='k'>Total Kolom</div><div class='v'>${columns.length}</div></div><div class='metric'><div class='k'>Sheet Aktif</div><div class='v'>${esc(activeSheetName)}</div></div><div class='metric'><div class='k'>Terakhir Dimuat</div><div class='v'>${esc(lastLoaded)}</div></div></div></div><div class='card archive-section archive-table-card'>${filterSummary}${ARCHIVE_STATE.refreshing?"<div class='subtitle archive-refreshing'>Memperbarui data…</div>":""}${!rows.length?`<div class='state'>${emptyMessage}${activeFilters.length?"<br><button class='btn-ghost' type='button' data-archive-reset-all>Reset Filter</button>":""}</div>`:`<div class='table-wrap table-wrap-full archive-table-wrap'><table><thead><tr>${columns.map(c=>renderArchiveFilterHeader(c,sourceRows,cacheKey)).join("")}</tr></thead><tbody>${pageRows.map(r=>`<tr>${columns.map(c=>`<td>${esc(r[c]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class='mv-pagination archive-pagination'><span>Menampilkan ${start+1}–${Math.min(start+ARCHIVE_STATE.pageSize,rows.length)} dari ${rows.length} ${activeFilters.length||ARCHIVE_STATE.search?"hasil":"data"}</span><div class='row archive-page-controls'><label>Baris per halaman: <select data-archive-page-size>${[25,50,100,200].map(size=>`<option value='${size}' ${ARCHIVE_STATE.pageSize===size?"selected":""}>${size} / halaman</option>`).join("")}</select></label><button class='btn-ghost' data-archive-page='-1' ${ARCHIVE_STATE.page<=1?"disabled":""}>← Prev</button><span>Halaman ${ARCHIVE_STATE.page} / ${totalPage}</span><button class='btn-ghost' data-archive-page='1' ${ARCHIVE_STATE.page>=totalPage?"disabled":""}>Next →</button></div></div>`}</div>`;}
function renderArchivePage(){if(!archiveApp)return;const selectedSource=ARCHIVE_STATE.selectedSpreadsheetKey;if(selectedSource&&!ARCHIVE_STATE.sheetList.length&&!ARCHIVE_STATE.loadingList)ensureArchiveList();const selectedSheet=ARCHIVE_STATE.selectedSheet;const {columns}=selectedSheet?getArchiveRows():{columns:[]};const sortOps=columns.map(c=>`<option value='${esc(c)}' ${ARCHIVE_STATE.sortColumn===c?"selected":""}>${esc(c)}</option>`).join("");archiveApp.innerHTML=`<div class='archive-layout'><div class='card archive-section'><div class='section-header'><h3 class='page-title'>Arsip</h3><div class='row'><select id='archiveSpreadsheetSelect'><option value=''>Pilih Spreadsheet</option>${ARCHIVE_SOURCES.map(src=>`<option value='${esc(src.key)}' ${src.key===selectedSource?"selected":""}>${esc(src.name)}</option>`).join("")}</select><select id='archiveSheetSelect' ${!selectedSource?'disabled':''}><option value=''>Pilih Sheet Arsip</option>${ARCHIVE_STATE.sheetList.map(s=>`<option value='${esc(s.key)}' ${s.key===selectedSheet?"selected":""}>${esc(s.name)}</option>`).join("")}</select><button id='archiveRefreshBtn' class='btn-ghost'>Refresh Arsip</button></div></div>${ARCHIVE_STATE.loadingList?"<div class='state'>Memuat daftar sheet arsip...</div>":ARCHIVE_STATE.listError?`<div class='state'>${esc(ARCHIVE_STATE.listError)}</div>`:""}</div><div class='card archive-section archive-filter-card'><div class='mv-filters open archive-filters'><input id='archiveSearch' class='search-lg' placeholder='Cari di semua kolom (min. 2 huruf)' value='${esc(ARCHIVE_STATE.searchInput)}'/><select id='archiveSortColumn'><option value=''>Urutkan Kolom</option>${sortOps}</select><select id='archiveSortDir'><option value='asc' ${ARCHIVE_STATE.sortDirection==='asc'?'selected':''}>ASC</option><option value='desc' ${ARCHIVE_STATE.sortDirection==='desc'?'selected':''}>DESC</option></select><select id='archiveColumnFilter'><option value='all'>Semua Kolom</option>${columns.map(c=>`<option value='${esc(c)}' ${ARCHIVE_STATE.columnFilter===c?'selected':''}>Filter: ${esc(c)}</option>`).join('')}</select></div></div><div id='archiveDataSection'></div></div>`;renderArchiveTableOnly();}


const MOVEMENT_HISTORY_RANGE="Movement!A1:H";
const MOVEMENT_STATE={sessionActive:false,searchInput:"",search:"",searchTimer:null,sessionItems:[],submitting:false,totalMovement:null,totalMovementLoading:false,totalMovementError:"",suggestionThreshold:5,suggestionPage:1,suggestionPageSize:25,suggestionCache:{key:"",rows:[],count:0}};
async function refreshMovementTotal(){if(MOVEMENT_STATE.totalMovementLoading)return;MOVEMENT_STATE.totalMovementLoading=true;MOVEMENT_STATE.totalMovementError="";renderMovementTotal();try{const headers=await getAuthHeaders();const {res,data}=await fetchJsonSafe('/api/movement/summary',{headers,cache:'no-store'});if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal menghitung Total Movement');MOVEMENT_STATE.totalMovement=Number(data.totalMovement)||0;}catch(err){MOVEMENT_STATE.totalMovementError=err?.message||'Gagal menghitung Total Movement';}finally{MOVEMENT_STATE.totalMovementLoading=false;renderMovementTotal();}}
function renderMovementTotal(){const value=document.getElementById('movementTotalValue'),error=document.getElementById('movementTotalError');if(value)value.textContent=MOVEMENT_STATE.totalMovementLoading&&MOVEMENT_STATE.totalMovement===null?'…':String(MOVEMENT_STATE.totalMovement??0);if(error){error.textContent=MOVEMENT_STATE.totalMovementError;error.hidden=!MOVEMENT_STATE.totalMovementError;}}
let movementHistoryPage=1;
let movementHistoryPageSize=10;
let MOVEMENT_HISTORY_REMOTE={rows:[],error:"",loaded:false};
function isValidMovementDate(value){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||""));if(!match)return false;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);const date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;}
function normalizeMovementDate(value){const candidate=String(value||"").trim().slice(0,10);return isValidMovementDate(candidate)?candidate:"";}
function canSubmitMovement(){return MOVEMENT_STATE.sessionItems.length>0&&MOVEMENT_STATE.sessionItems.every(it=>String(it.to||"").trim()&&Number.isFinite(it.stokAktual));}
function getMovementSourceRows(){return getCycleSourceRows();}
function getMovementCandidates(query){const q=clean(query);if(!q)return[];return getMovementSourceRows().filter(r=>clean(`${r.sku} ${r.nama} ${r.lokasi}`).includes(q)).slice(0,80);}
function parseLokasiSignature(rawLokasi){const lokasi=String(rawLokasi||"").trim().toUpperCase();const letters=(lokasi.match(/[A-Z]+/g)||[]).join("");const digits=(lokasi.match(/\d/g)||[]).length;return {lokasi,letters,digits,signature:`${letters}|${digits}`};}
function getMovementSuggestionSourceKey(rows){if(!Array.isArray(rows)||!rows.length)return "0";return `${rows.length}|${rows[0]?.sku||""}|${rows[0]?.lokasi||""}|${rows[rows.length-1]?.sku||""}|${rows[rows.length-1]?.lokasi||""}`;}
function computeMovementSuggestions(){const source=getMovementSourceRows();const key=`${MOVEMENT_STATE.suggestionThreshold}|${getMovementSuggestionSourceKey(source)}`;if(MOVEMENT_STATE.suggestionCache.key===key)return MOVEMENT_STATE.suggestionCache;const grouped=new Map();for(const row of source){const sku=String(row.sku||"").trim();if(!sku)continue;const qty=Number(row.stok_akhir)||0;const sig=parseLokasiSignature(row.lokasi);if(!grouped.has(sku))grouped.set(sku,{sku,names:new Map(),locations:[],totalQty:0});const bucket=grouped.get(sku);const nama=String(row.nama||"-").trim()||"-";bucket.names.set(nama,(bucket.names.get(nama)||0)+1);bucket.locations.push({lokasi:row.lokasi||"-",qty,signature:sig.signature,digitCount:sig.digits,nama});bucket.totalQty+=qty;}const suggestions=[];grouped.forEach(item=>{if(item.locations.length<=1)return;const groupsByType=new Map();item.locations.forEach(loc=>{if(!groupsByType.has(loc.signature))groupsByType.set(loc.signature,[]);groupsByType.get(loc.signature).push(loc);});groupsByType.forEach(groupLocs=>{if(groupLocs.length<=1)return;const mergedByLokasi=new Map();groupLocs.forEach(loc=>{const keyLok=String(loc.lokasi||"-").trim().toUpperCase();const existing=mergedByLokasi.get(keyLok);if(existing){existing.qty+=Number(loc.qty)||0;}else{mergedByLokasi.set(keyLok,{lokasi:loc.lokasi,qty:Number(loc.qty)||0,signature:loc.signature,digitCount:loc.digitCount});}});const normalizedLocs=[...mergedByLokasi.values()];if(normalizedLocs.length<=1)return;const sorted=normalizedLocs.sort((a,b)=>b.qty-a.qty);const target=sorted[0];if(!target||target.qty<=0)return;const pickedName=[...item.names.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"-";for(let i=1;i<sorted.length;i++){const origin=sorted[i];if(origin.qty<=0||origin.qty>=MOVEMENT_STATE.suggestionThreshold)continue;if(item.totalQty<=origin.qty)continue;suggestions.push({sku:item.sku,nama:pickedName,fromLokasi:origin.lokasi,toLokasi:target.lokasi,toQty:target.qty,qtyMove:origin.qty,totalLokasi:normalizedLocs.length});}});});MOVEMENT_STATE.suggestionCache={key,rows:suggestions,count:suggestions.length};return MOVEMENT_STATE.suggestionCache;}
function fillMovementFromSuggestion(index){const cache=computeMovementSuggestions();const picked=cache.rows[index];if(!picked)return;MOVEMENT_STATE.sessionActive=true;MOVEMENT_STATE.search="";MOVEMENT_STATE.searchInput="";MOVEMENT_STATE.sessionItems=[];const source=getMovementSourceRows().find(r=>clean(r.sku)===clean(picked.sku)&&clean(r.lokasi)===clean(picked.fromLokasi));if(!source){toast('Data sumber tidak ditemukan','error');return;}addMovementItem(source,{silentSuccess:true});const first=MOVEMENT_STATE.sessionItems[0];if(first){first.to=picked.toLokasi;first.stokAktual=Number(picked.qtyMove)||0;}renderMovementPage();toast('Form movement terisi dari saran','success');}
function renderMovementSuggestionSection(){const cache=computeMovementSuggestions();const rows=cache.rows;const count=cache.count;const size=MOVEMENT_STATE.suggestionPageSize;const totalPages=Math.max(1,Math.ceil(rows.length/size));if(MOVEMENT_STATE.suggestionPage>totalPages)MOVEMENT_STATE.suggestionPage=totalPages;const start=(MOVEMENT_STATE.suggestionPage-1)*size;const pageRows=rows.slice(start,start+size);const indicator=`<div class='muted small'>${count} SKU bisa dioptimalkan</div>`;if(!rows.length)return `<div class='card cc-card cc-section'><div class='section-header'><h4>Saran Movement</h4>${indicator}</div><div class='state'>Tidak ada saran movement</div></div>`;const body=pageRows.map((r,i)=>`<tr><td>${esc(r.sku)}</td><td>${esc(r.nama)}</td><td>${esc(r.fromLokasi)} (${esc(r.qtyMove)})</td><td>${esc(r.toLokasi)} (${esc(r.toQty)})</td><td>${esc(r.qtyMove)}</td><td>${esc(r.totalLokasi)} lokasi</td><td><button class='btn-primary' data-mvm-action='use-suggestion' data-idx='${start+i}'>Buat Movement</button></td></tr>`).join("");return `<div class='card cc-card cc-section'><div class='section-header'><h4>Saran Movement</h4>${indicator}</div><div class='table-wrap cc-table-wrap'><table><thead><tr><th>SKU</th><th>Nama Barang</th><th>Lokasi Asal (qty kecil)</th><th>Lokasi Tujuan (qty terbesar)</th><th>Qty Disarankan</th><th>Total Lokasi Saat Ini</th><th>Aksi</th></tr></thead><tbody>${body}</tbody></table></div><div class='mv-pagination'><span>Menampilkan ${rows.length?start+1:0}-${Math.min(start+size,rows.length)} dari ${rows.length} data</span><div class='row'><select id='mvSuggestionPageSize'><option value='25'>25</option><option value='50'>50</option></select><button id='mvSuggestionPrev' class='btn-ghost'>Prev</button><button id='mvSuggestionNext' class='btn-ghost'>Next</button></div></div></div>`;}
function normalizeMovementHeader(v){return String(v||"").toLowerCase().trim().replace(/\s+/g," ").replace(/ /g,"_");}
function findMovementHeaderRow(values){for(let i=0;i<values.length;i++){const norm=(values[i]||[]).map(normalizeMovementHeader);if(norm.includes("tanggal")&&norm.includes("from")&&norm.includes("to")&&norm.includes("sku"))return i;}return -1;}
function mapMovementHeaderIndex(headerRow){const normalized=(headerRow||[]).map(normalizeMovementHeader);const aliases={nama:["nama","nama_barang"],awal:["awal","stok_lokasi_awal"],aktual:["aktual","stok_aktual"],keterangan:["keterangan"]};const idx={tanggal:normalized.indexOf("tanggal"),from:normalized.indexOf("from"),to:normalized.indexOf("to"),sku:normalized.indexOf("sku"),nama:-1,awal:-1,aktual:-1,keterangan:-1};for(const key of ["nama","awal","aktual","keterangan"]){for(const alias of aliases[key]){const at=normalized.indexOf(alias);if(at>=0){idx[key]=at;break;}}}return idx;}
function parseMovementRows(values,idx,startRow){const rows=[];for(let i=startRow;i<values.length;i++){const r=values[i]||[];if(!r.some(c=>String(c||"").trim()))continue;rows.push({tanggal:normalizeMovementDate(r[idx.tanggal]),from:String(r[idx.from]||""),to:String(r[idx.to]||""),sku:String(r[idx.sku]||""),nama:String(r[idx.nama]||""),stok_lokasi_awal:parseNumber(r[idx.awal]??0),stok_aktual:parseNumber(r[idx.aktual]??0),keterangan:idx.keterangan>=0?String(r[idx.keterangan]||""):"",rowNumber:i+1});}return rows;}
function parseMovementHistoryRows(rawValues){try{const rows=parseRows(rawValues);return {rows:rows.map((r,i)=>({tanggal:normalizeMovementDate(r.tanggal),from:r.lokasi,to:r.retail?String(r.retail):String((rawValues||[])[0]||""),sku:r.sku,nama:r.nama_barang,stok_lokasi_awal:r.bulky,stok_aktual:r.aktual_bulky,keterangan:r.catatan||"",rowNumber:i+4})),error:""};}catch(_){const values=Array.isArray(rawValues)?rawValues:[];if(!values.length)return {rows:[],error:""};const headerRow=findMovementHeaderRow(values);if(headerRow<0)return {rows:[],error:"Header Movement tidak valid: tanggal, from, to, sku"};const idx=mapMovementHeaderIndex(values[headerRow]||[]);const required=["tanggal","from","to","sku","nama","awal","aktual"];const miss=required.filter(k=>idx[k]<0);if(miss.length)return {rows:[],error:`Header Movement tidak valid: ${miss.join(", ")}`};return {rows:parseMovementRows(values,idx,headerRow+1),error:""};}}
async function fetchMovementHistoryRemote(){const url=`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(MOVEMENT_HISTORY_RANGE)}?key=${API_KEY}`;const res=await fetch(url,{cache:'no-store'});const json=await res.json();if(!res.ok||json.error)throw new Error((json.error&&json.error.message)||res.statusText||"Gagal memuat sheet Data Movement Barang");return parseMovementHistoryRows(json.values||[]);}
async function ensureMovementHistoryLoaded(){if(MOVEMENT_HISTORY_REMOTE.loaded)return;try{const parsed=await fetchMovementHistoryRemote();MOVEMENT_HISTORY_REMOTE={rows:parsed.rows,error:parsed.error||"",loaded:true};}catch(err){MOVEMENT_HISTORY_REMOTE={...MOVEMENT_HISTORY_REMOTE,error:`Gagal fetch Movement: ${err.message||"unknown error"}`,loaded:true};}}
function buildMovementHistoryRows(){return [...(MOVEMENT_HISTORY_REMOTE.rows||[])];}
function renderMovementSearchResults(){const tbody=document.querySelector('#mvSearchResultsBody');if(!tbody)return;const candidates=MOVEMENT_STATE.sessionActive?getMovementCandidates(MOVEMENT_STATE.search):[];if(!candidates.length){tbody.innerHTML="<tr><td colspan='5'><div class='state cc-state'>Cari SKU untuk menambah item movement.</div></td></tr>";return;}const frag=document.createDocumentFragment();candidates.forEach(c=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(c.lokasi)}</td><td>${esc(c.sku)}</td><td>${esc(c.nama)}</td><td>${esc(c.stok_akhir)}</td><td><button class='btn-ghost' data-mvm-action='add' data-sku='${encAttr(c.sku)}' data-lok='${encAttr(c.lokasi)}'>Tambah</button></td>`;frag.appendChild(tr);});tbody.replaceChildren(frag);}
function renderMovementSessionTable(){const tbody=document.querySelector('#mvSessionBody');if(!tbody)return;const submitBtn=document.getElementById('mvSubmitBtn');if(submitBtn){submitBtn.disabled=!canSubmitMovement()||MOVEMENT_STATE.submitting;submitBtn.textContent=MOVEMENT_STATE.submitting?"Menyimpan...":"Selesai Movement";}if(!MOVEMENT_STATE.sessionItems.length){tbody.innerHTML="<tr><td colspan='7'><div class='state cc-state'>Belum ada item dalam session.</div></td></tr>";return;}const frag=document.createDocumentFragment();MOVEMENT_STATE.sessionItems.forEach((r,i)=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(r.lokasi)}</td><td><input class='mv-compact-input mv-to-input' data-mvm='to' data-idx='${i}' value='${esc(r.to||"")}' placeholder='Lokasi tujuan' inputmode='text' autocomplete='off'></td><td>${esc(r.sku)}</td><td>${esc(r.nama)}</td><td>${esc(r.stokAwal)}</td><td><input class='mv-compact-input mv-stock-input' type='number' data-mvm='akt' data-idx='${i}' value='${r.stokAktual??""}' placeholder='Qty' inputmode='numeric'></td><td><button class='btn-ghost' data-mvm-action='remove' data-idx='${i}'>Hapus</button></td>`;frag.appendChild(tr);});tbody.replaceChildren(frag);}
function renderMovementHistory(){const tbody=document.querySelector('#mvHistoryBody');if(!tbody)return;const info=document.getElementById('mvHistoryInfo');const prev=document.getElementById('mvHistoryPrev');const next=document.getElementById('mvHistoryNext');const sizeSel=document.getElementById('mvHistoryPageSize');const historySorted=[...buildMovementHistoryRows()].reverse();const total=historySorted.length;const totalPages=Math.max(1,Math.ceil(total/movementHistoryPageSize));if(movementHistoryPage>totalPages)movementHistoryPage=totalPages;const start=(movementHistoryPage-1)*movementHistoryPageSize;const end=start+movementHistoryPageSize;const pageRows=historySorted.slice(start,end);if(sizeSel)sizeSel.value=String(movementHistoryPageSize);if(info)info.textContent=`Menampilkan ${total?start+1:0}-${Math.min(end,total)} dari ${total} data`;if(prev)prev.disabled=movementHistoryPage<=1;if(next)next.disabled=movementHistoryPage>=totalPages;if(!total){tbody.innerHTML="<tr><td colspan='9'><div class='state'>Belum ada history movement.</div></td></tr>";return;}const frag=document.createDocumentFragment();pageRows.forEach(r=>{const edit=HISTORY_EDIT_STATE.movement[r.rowNumber];const tr=document.createElement('tr');if(edit){tr.innerHTML=`<td><input type='date' data-mvh-edit='tanggal' data-row='${r.rowNumber}' value='${esc(normalizeMovementDate(edit.tanggal))}' required></td><td><input data-mvh-edit='from' data-row='${r.rowNumber}' value='${esc(edit.from||"")}'></td><td><input data-mvh-edit='to' data-row='${r.rowNumber}' value='${esc(edit.to||"")}'></td><td><input data-mvh-edit='sku' data-row='${r.rowNumber}' value='${esc(edit.sku||"")}'></td><td><input data-mvh-edit='nama' data-row='${r.rowNumber}' value='${esc(edit.nama||"")}'></td><td><input type='number' data-mvh-edit='stok_lokasi_awal' data-row='${r.rowNumber}' value='${esc(edit.stok_lokasi_awal)}'></td><td><input type='number' data-mvh-edit='stok_aktual' data-row='${r.rowNumber}' value='${esc(edit.stok_aktual)}'></td><td>${esc(edit.keterangan||"-")}</td><td><button class='btn-ghost' data-mvh-action='save' data-row='${r.rowNumber}'>Simpan</button> <button class='btn-ghost' data-mvh-action='cancel' data-row='${r.rowNumber}'>Batal</button></td>`;}else{tr.innerHTML=`<td class='editable-cell' data-mvh-field='tanggal' data-row='${r.rowNumber}'>${esc(normalizeMovementDate(r.tanggal)||"-")}</td><td class='editable-cell' data-mvh-field='from' data-row='${r.rowNumber}'>${esc(r.from||"-")}</td><td class='editable-cell' data-mvh-field='to' data-row='${r.rowNumber}'>${esc(r.to||"-")}</td><td>${esc(r.sku||"-")}</td><td>${esc(r.nama||"-")}</td><td class='editable-cell' data-mvh-field='stok_lokasi_awal' data-row='${r.rowNumber}'>${esc(r.stok_lokasi_awal)}</td><td class='editable-cell' data-mvh-field='stok_aktual' data-row='${r.rowNumber}'>${esc(r.stok_aktual)}</td><td>${esc(r.keterangan||"-")}</td><td><button class='icon-btn danger' title='Hapus' aria-label='Hapus data' data-mvh-action='delete' data-row='${r.rowNumber}'><i data-lucide='trash-2'></i></button></td>`;}frag.appendChild(tr);});tbody.replaceChildren(frag);if(window.lucide&&typeof window.lucide.createIcons==='function')window.lucide.createIcons();}


async function handleMovementScanSearchResult(scannedSku){
  let result;
  try{result=await resolveScannedSku(scannedSku);}
  catch(err){console.error("Barcode lookup failed",err);showToast('Gagal mencari barcode. Silakan coba lagi.','error');return;}
  const {scanned,sku,mapped}=result;
  if(!scanned){showToast('Barcode tidak ditemukan','error');return;}
  MOVEMENT_STATE.searchInput=sku;
  MOVEMENT_STATE.search=sku;
  const input=document.getElementById('movementSearchInput');
  if(input)input.value=sku;
  renderMovementSearchResults();
  if(!mapped){showToast('Barcode tidak ditemukan','error');return;}
  showToast('SKU berhasil discan. Pilih lokasi awal yang benar.','success');
}

function openMovementScanner(){
  if(!MOVEMENT_STATE.sessionActive){toast('Mulai Movement dulu sebelum scan.','error');return;}
  openBarcodeScanner('movementSearchInput',handleMovementScanSearchResult);
}

function renderMovementEmptyState(){return `<div class='cc-empty-state'><i data-lucide='arrow-right-left'></i><h4>Belum ada movement berjalan</h4><p>Klik Mulai Movement untuk memilih SKU dan input stok aktual.</p></div>`;}
function renderMovementSession(){return `<div class='cc-section'><div class='mv-toolbar'><div class='search-bar search-bar-with-scan movement-scan-bar'><input id='movementSearchInput' class='search-lg' placeholder='Cari / scan SKU...' value='${esc(MOVEMENT_STATE.searchInput)}'><button id='movementScanBtn' class='icon-btn scan-barcode-btn' type='button' title='Scan barcode' aria-label='Scan barcode'><i data-lucide='scan-line'></i></button></div></div></div><div class='cc-section'><div class='table-wrap cc-table-wrap cc-search-wrap'><table><thead><tr><th>Lokasi</th><th>SKU</th><th>Nama Barang</th><th>Qty</th><th>Aksi</th></tr></thead><tbody id='mvSearchResultsBody'></tbody></table></div></div><div class='cc-section'><h4>Movement Berjalan</h4><div class='table-wrap cc-table-wrap cc-session-wrap'><table><thead><tr><th>From</th><th>To</th><th>SKU</th><th>Nama Barang</th><th>Stok Lokasi Awal</th><th>Stok Aktual</th><th>Aksi</th></tr></thead><tbody id='mvSessionBody'></tbody></table></div></div>`;}
function renderMovementPage(){if(!movementApp)return;movementApp.innerHTML=`<div class='grid dashboard'><div class='metric'><div class='k'>Total Movement</div><div class='v' id='movementTotalValue'>${MOVEMENT_STATE.totalMovementLoading&&MOVEMENT_STATE.totalMovement===null?'…':esc(MOVEMENT_STATE.totalMovement??0)}</div><small id='movementTotalError' class='state-error' ${MOVEMENT_STATE.totalMovementError?'':'hidden'}>${esc(MOVEMENT_STATE.totalMovementError)}</small></div></div><div class='card cc-card cc-section'><div class='section-header cc-main-header'><div class='cc-action-stack'>${MOVEMENT_STATE.sessionActive?"<button class='btn-ghost' onclick='mvCancelSession()'>Batal Movement</button>":""}<button class='btn-primary' onclick='mvStartSession()' ${(!getPermissions().canCreate||MOVEMENT_STATE.sessionActive)?"disabled":""}>Mulai Movement</button>${MOVEMENT_STATE.sessionActive?"<button id='mvSubmitBtn' class='btn-primary' onclick='mvSubmitSession()'>Selesai Movement</button>":""}</div></div>${MOVEMENT_HISTORY_REMOTE.error?`<div class='state cc-state state-error'>${esc(MOVEMENT_HISTORY_REMOTE.error)}</div>`:""}${MOVEMENT_STATE.sessionActive?renderMovementSession():renderMovementEmptyState()}</div>${renderMovementSuggestionSection()}<div class='card cc-card cc-section mv-history-section'><div class='section-header'><h4>History Movement</h4></div><div class='table-wrap cc-table-wrap'><table><thead><tr><th>Tanggal</th><th>From</th><th>To</th><th>SKU</th><th>Nama Barang</th><th>Stok Lokasi Awal</th><th>Stok Aktual</th><th>Keterangan</th><th>Aksi</th></tr></thead><tbody id='mvHistoryBody'></tbody></table></div><div class='mv-pagination'><span id='mvHistoryInfo'>Menampilkan 0-0 dari 0 data</span><div class='row'><select id='mvHistoryPageSize'><option value='10'>10</option><option value='25'>25</option><option value='50'>50</option></select><button id='mvHistoryPrev' class='btn-ghost'>Prev</button><button id='mvHistoryNext' class='btn-ghost'>Next</button></div></div></div>`;if(window.lucide)window.lucide.createIcons();const sizeSel=document.getElementById('mvSuggestionPageSize');if(sizeSel)sizeSel.value=String(MOVEMENT_STATE.suggestionPageSize);if(MOVEMENT_STATE.sessionActive){renderMovementSearchResults();renderMovementSessionTable();}renderMovementHistory();ensureMovementHistoryLoaded().then(renderMovementHistory);if(MOVEMENT_STATE.totalMovement===null&&!MOVEMENT_STATE.totalMovementLoading)refreshMovementTotal();}
window.mvStartSession=()=>{MOVEMENT_STATE.sessionActive=true;MOVEMENT_STATE.search="";MOVEMENT_STATE.searchInput="";MOVEMENT_STATE.sessionItems=[];renderMovementPage();};
window.mvCancelSession=()=>{showConfirmModal({title:'Batal Movement',message:'Batalkan movement yang sedang berjalan?',confirmText:'Ya, Batalkan',cancelText:'Kembali',type:'danger',onConfirm:()=>{MOVEMENT_STATE.sessionActive=false;MOVEMENT_STATE.search="";MOVEMENT_STATE.searchInput="";MOVEMENT_STATE.sessionItems=[];MOVEMENT_STATE.submitting=false;renderMovementPage();}});};
function addMovementItem(source,opts={}){const item={lokasi:source.lokasi,sku:source.sku,nama:source.nama,stokAwal:source.stok_akhir,to:"",stokAktual:null};if(MOVEMENT_STATE.sessionItems.some(it=>clean(it.sku)===clean(item.sku)&&clean(it.lokasi)===clean(item.lokasi))){toast('SKU/lokasi sudah ada di session.','error');return false;}MOVEMENT_STATE.sessionItems.push(item);renderMovementSessionTable();if(!opts.silentSuccess)toast('Item ditambahkan','success');return true;}

function normalizeRole(role){
  const r = String(role || "")
    .toLowerCase()
    .replace("pic", "")
    .replace("role", "")
    .replace("mode", "")
    .trim();

  if (r.includes("dev")) return "developer";
  if (r.includes("inbound")) return "inbound";
  if (r.includes("outbound")) return "outbound";
  if (r.includes("picker")) return "picker";
  if (r.includes("inventory")) return "inventory";

  return r;
}
window.mvSubmitSession=async()=>{if(!canSubmitMovement()){toast('Lengkapi tujuan dan stok aktual semua item.','error');return;}const dup=new Set();for(const it of MOVEMENT_STATE.sessionItems){const key=`${clean(it.sku)}|${clean(it.lokasi)}|${clean(it.to)}`;if(dup.has(key)){toast('Duplikasi SKU + From + To terdeteksi.','error');return;}dup.add(key);}MOVEMENT_STATE.submitting=true;renderMovementSessionTable();try{const rawRole=getCurrentUserRole();const normalizedRole=normalizeRole(rawRole);const pic=APP_CONFIG.PIC_BY_ROLE[normalizedRole]||APP_CONFIG.PIC_BY_ROLE.inventory;const finalPic=String(pic).toUpperCase();const items=MOVEMENT_STATE.sessionItems.map(it=>({from:it.lokasi,to:String(it.to||'').trim(),sku:it.sku,namaBarang:it.nama,qty:Number(it.stokAktual),pic:finalPic,stokDiLokasiAwal:Number(it.stokAwal),stokAktual:Number(it.stokAktual)}));const res=await fetch('/api/movement/in',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items})});const data=await res.json();if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal menyimpan movement');items.forEach(it=>{logActivitySafe({action:'CREATE_MOVEMENT',module:'Movement',detail:`[CREATE] Movement\nSKU: ${it.sku}\nQty: ${it.qty}\nStatus: Movement`,status:'SUCCESS',metadata:{inventorySheet:'Movement',inventorySpreadsheet:'SHEET_ID_INVENTORY',syncedTo2026:true,tanggal:data.businessDate,from:it.from,to:it.to,sku:it.sku,namaBarang:it.namaBarang,qty:it.qty,status:'Movement',pic:it.pic,keterangan:'INTERNAL STOCK TRANSFER'}});});toast(`Movement berhasil disimpan (${items.length} SKU)`,'success');MOVEMENT_STATE.sessionActive=false;MOVEMENT_STATE.searchInput='';MOVEMENT_STATE.search='';MOVEMENT_STATE.sessionItems=[];MOVEMENT_HISTORY_REMOTE.loaded=false;await ensureMovementHistoryLoaded();if(typeof syncData==='function')await syncData({silent:true,force:true});await refreshMovementTotal();}catch(err){toast(err?.message||'Gagal menyimpan movement','error');}finally{MOVEMENT_STATE.submitting=false;renderMovementPage();}};
document.addEventListener('input',e=>{if(e.target?.id==='movementSearchInput'){MOVEMENT_STATE.searchInput=e.target.value;movementHistoryPage=1;clearTimeout(MOVEMENT_STATE.searchTimer);MOVEMENT_STATE.searchTimer=setTimeout(()=>{MOVEMENT_STATE.search=MOVEMENT_STATE.searchInput;renderMovementSearchResults();},280);return;}if(e.target?.id==='mvHistoryPageSize'){movementHistoryPageSize=Number(e.target.value)||10;movementHistoryPage=1;renderMovementHistory();return;}if(e.target?.id==='mvSuggestionPageSize'){MOVEMENT_STATE.suggestionPageSize=Number(e.target.value)||25;MOVEMENT_STATE.suggestionPage=1;renderMovementPage();return;}if(e.target?.dataset?.mvm){const idx=Number(e.target.dataset.idx);const row=MOVEMENT_STATE.sessionItems[idx];if(!row)return;if(e.target.dataset.mvm==='to')row.to=e.target.value||"";if(e.target.dataset.mvm==='akt'){const n=Number(e.target.value);row.stokAktual=Number.isFinite(n)?n:null;}const submitBtn=document.getElementById('mvSubmitBtn');if(submitBtn)submitBtn.disabled=!canSubmitMovement()||MOVEMENT_STATE.submitting;}});
document.addEventListener('input',e=>{const field=e.target?.dataset?.mvhEdit;if(!field)return;const edit=HISTORY_EDIT_STATE.movement[Number(e.target.dataset.row)];if(edit)edit[field]=e.target.value;});
document.addEventListener('click',async e=>{const cell=e.target?.closest('[data-mvh-field]');if(cell){const row=(MOVEMENT_HISTORY_REMOTE.rows||[]).find(item=>Number(item.rowNumber)===Number(cell.dataset.row));if(!row)return;HISTORY_EDIT_STATE.movement[row.rowNumber]={...row,tanggal:normalizeMovementDate(row.tanggal)};renderMovementHistory();return;}const button=e.target?.closest('[data-mvh-action]');if(!button)return;const rowNumber=Number(button.dataset.row);if(button.dataset.mvhAction==='cancel'){delete HISTORY_EDIT_STATE.movement[rowNumber];renderMovementHistory();return;}const original=(MOVEMENT_HISTORY_REMOTE.rows||[]).find(item=>Number(item.rowNumber)===rowNumber);if(button.dataset.mvhAction==='save'&&original){const edit=HISTORY_EDIT_STATE.movement[rowNumber];if(!isValidMovementDate(edit?.tanggal)){toast('Tanggal harus berformat YYYY-MM-DD.','error');return;}button.disabled=true;try{for(const field of ['tanggal','from','to','stok_lokasi_awal','stok_aktual'])if(String(edit[field]??'')!==String(original[field]??''))await updateHistoryCell('movement','Movement',original,field,edit[field],original[field]);delete HISTORY_EDIT_STATE.movement[rowNumber];renderMovementHistory();}catch(err){button.disabled=false;toast(err?.message||'Gagal update Movement','error');}return;}if(button.dataset.mvhAction==='delete'&&original){showConfirmModal({title:'Hapus Movement',message:'Yakin ingin menghapus movement ini?',confirmText:'Hapus',cancelText:'Batal',type:'danger',onConfirm:async()=>{const res=await fetch('/api/delete-row',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sheetName:'Movement',rowNumber})});const data=await res.json();if(!res.ok||!data?.success){toast(data?.message||'Gagal menghapus Movement','error');return;}MOVEMENT_HISTORY_REMOTE.rows=MOVEMENT_HISTORY_REMOTE.rows.filter(item=>Number(item.rowNumber)!==rowNumber);renderMovementHistory();}});}});
document.addEventListener('click',e=>{if(e.target?.closest('[data-cc-history-retry]')){retryCycleCountHistory();return;}if(e.target?.id==='ccHistoryPrev'){cycleHistoryPage=Math.max(1,cycleHistoryPage-1);loadCycleCountHistory({force:true});return;}if(e.target?.id==='ccHistoryNext'){cycleHistoryPage+=1;loadCycleCountHistory({force:true});return;}if(e.target?.closest('#movementScanBtn')){openMovementScanner();return;}if(e.target?.id==='mvHistoryPrev'){movementHistoryPage=Math.max(1,movementHistoryPage-1);renderMovementHistory();return;}if(e.target?.id==='mvHistoryNext'){movementHistoryPage+=1;renderMovementHistory();return;}if(e.target?.id==='mvSuggestionPrev'){MOVEMENT_STATE.suggestionPage=Math.max(1,MOVEMENT_STATE.suggestionPage-1);renderMovementPage();return;}if(e.target?.id==='mvSuggestionNext'){MOVEMENT_STATE.suggestionPage+=1;renderMovementPage();return;}const btn=e.target.closest('[data-mvm-action]');if(!btn)return;const action=btn.dataset.mvmAction;if(action==='remove'){const idx=Number(btn.dataset.idx);MOVEMENT_STATE.sessionItems.splice(idx,1);renderMovementSessionTable();return;}if(action==='add'){const sku=decodeURIComponent(btn.dataset.sku||"");const lokasi=decodeURIComponent(btn.dataset.lok||"");const source=getMovementSourceRows().find(r=>clean(r.sku)===clean(sku)&&clean(r.lokasi)===clean(lokasi));if(source)addMovementItem(source);return;}if(action==='use-suggestion'){const idx=Number(btn.dataset.idx);if(Number.isFinite(idx))fillMovementFromSuggestion(idx);}});

const ASSET_STORE_SPREADSHEET_ID="1uYIE_St-w1_VLyqSpTdvrThZToJnSkRdTuSMRaWnHyE";
const ASSET_STORE_SOURCE_COLUMN="Nama Sheet";
const ASSET_STORE_STATE={sheetList:[],selectedSheet:"",cache:{},loadingList:false,loadingData:false,listError:"",dataError:"",searchInput:"",search:"",searchTimer:null,searchToken:0,minSearchLength:2,sortColumn:"",sortDirection:"asc",columnFilter:"all",page:1,pageSize:25,lastLoadedAt:{}};
function bindAssetStoreEvents(){document.addEventListener("change",e=>{if(e.target?.id==="assetStoreSheetSelect")selectAssetStoreSheet(e.target.value);if(e.target?.id==="assetStoreSortColumn"){ASSET_STORE_STATE.sortColumn=e.target.value;ASSET_STORE_STATE.page=1;renderAssetStoreTableOnly();}if(e.target?.id==="assetStoreSortDir"){ASSET_STORE_STATE.sortDirection=e.target.value;ASSET_STORE_STATE.page=1;renderAssetStoreTableOnly();}if(e.target?.id==="assetStoreColumnFilter"){ASSET_STORE_STATE.columnFilter=e.target.value;ASSET_STORE_STATE.page=1;renderAssetStoreTableOnly();}});document.addEventListener("input",e=>{if(e.target?.id!=="assetStoreSearch")return;ASSET_STORE_STATE.searchInput=e.target.value||"";const debounceToken=++ASSET_STORE_STATE.searchToken;clearTimeout(ASSET_STORE_STATE.searchTimer);ASSET_STORE_STATE.searchTimer=setTimeout(()=>{if(debounceToken!==ASSET_STORE_STATE.searchToken)return;const rawInput=String(ASSET_STORE_STATE.searchInput||"").trim();ASSET_STORE_STATE.search=rawInput.length>=ASSET_STORE_STATE.minSearchLength?rawInput:"";ASSET_STORE_STATE.page=1;renderAssetStoreTableOnly();},380);});document.addEventListener("click",e=>{if(e.target?.closest("#assetStoreRefreshBtn"))refreshAssetStore();const pg=e.target?.closest("[data-asset-store-page]");if(pg){ASSET_STORE_STATE.page=Math.max(1,ASSET_STORE_STATE.page+(Number(pg.dataset.assetStorePage)||0));renderAssetStoreTableOnly();return;}});}
async function fetchAssetStoreSheetList(){const url=`https://sheets.googleapis.com/v4/spreadsheets/${ASSET_STORE_SPREADSHEET_ID}?fields=sheets.properties.title&key=${API_KEY}`;const res=await fetch(url);const json=await res.json();if(!res.ok||json.error)throw new Error((json.error&&json.error.message)||res.statusText||'Gagal memuat daftar sheet');return (json.sheets||[]).map((s,idx)=>({key:String(s?.properties?.title||`Sheet${idx+1}`),name:String(s?.properties?.title||`Sheet ${idx+1}`)})).filter(sheet=>sheet.name.toLowerCase().includes('asset'));}
async function fetchAssetStoreSheetData(sheetName){const range=`${sheetName}!A1:ZZ`;const url=`https://sheets.googleapis.com/v4/spreadsheets/${ASSET_STORE_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;const res=await fetch(url);const json=await res.json();if(!res.ok||json.error)throw new Error((json.error&&json.error.message)||res.statusText||'Gagal memuat data sheet');const values=Array.isArray(json.values)?json.values:[];if(!values.length)return {columns:[],rows:[],headerError:false};const headers=(values[0]||[]).map(v=>String(v||'').trim());if(!headers.some(Boolean))return {columns:[],rows:[],headerError:true};const columns=headers.map((h,i)=>h||`Column ${i+1}`);const rows=[];for(let i=1;i<values.length;i++){const line=values[i]||[];if(!line.some(c=>String(c||'').trim()))continue;const row={__rowNumber:i+1};columns.forEach((c,idx)=>{row[c]=line[idx]??'';});rows.push(row);}return {columns,rows,headerError:false};}
async function ensureAssetStoreList(){if(ASSET_STORE_STATE.sheetList.length||ASSET_STORE_STATE.loadingList)return;ASSET_STORE_STATE.loadingList=true;ASSET_STORE_STATE.listError="";renderAssetStorePage();try{ASSET_STORE_STATE.sheetList=await fetchAssetStoreSheetList();}catch(err){ASSET_STORE_STATE.listError=err.message||"Gagal memuat daftar sheet";}finally{ASSET_STORE_STATE.loadingList=false;renderAssetStorePage();if(ASSET_STORE_STATE.sheetList.length)selectAssetStoreSheet(ASSET_STORE_STATE.selectedSheet);}}
async function selectAssetStoreSheet(sheetName){ASSET_STORE_STATE.selectedSheet=sheetName||"";ASSET_STORE_STATE.page=1;ASSET_STORE_STATE.dataError="";const sheets=sheetName?[sheetName]:ASSET_STORE_STATE.sheetList.map(s=>s.key);const unloaded=sheets.filter(name=>!ASSET_STORE_STATE.cache[name]);if(!unloaded.length){renderAssetStorePage();return;}ASSET_STORE_STATE.loadingData=true;renderAssetStoreTableOnly();try{const results=await Promise.all(unloaded.map(async name=>({name,data:await fetchAssetStoreSheetData(name)})));const loadedAt=new Date().toISOString();results.forEach(({name,data})=>{ASSET_STORE_STATE.cache[name]=data;ASSET_STORE_STATE.lastLoadedAt[name]=loadedAt;});}catch(err){ASSET_STORE_STATE.dataError=err.message||"Gagal memuat data sheet";}finally{ASSET_STORE_STATE.loadingData=false;renderAssetStorePage();}}
async function refreshAssetStore(){const sheet=ASSET_STORE_STATE.selectedSheet;const sheets=sheet?[sheet]:ASSET_STORE_STATE.sheetList.map(s=>s.key);sheets.forEach(name=>delete ASSET_STORE_STATE.cache[name]);await selectAssetStoreSheet(sheet);}
function getAssetStoreRows(){const selected=ASSET_STORE_STATE.selectedSheet;const sheetNames=selected?[selected]:ASSET_STORE_STATE.sheetList.map(s=>s.key);const parsedSheets=sheetNames.map(name=>({name,parsed:ASSET_STORE_STATE.cache[name]})).filter(x=>x.parsed);const columns=parsedSheets.length?[ASSET_STORE_SOURCE_COLUMN,...new Set(parsedSheets.flatMap(x=>x.parsed.columns||[]).filter(column=>column!==ASSET_STORE_SOURCE_COLUMN))]:[];let rows=parsedSheets.flatMap(({name,parsed})=>(parsed.rows||[]).map(row=>({...row,[ASSET_STORE_SOURCE_COLUMN]:name,__sheetName:name})));const headerError=parsedSheets.length>0&&parsedSheets.every(x=>x.parsed.headerError);const totalSource=rows.length;const q=clean(ASSET_STORE_STATE.search);if(q){rows=rows.filter(r=>{if(ASSET_STORE_STATE.columnFilter!=='all')return clean(r[ASSET_STORE_STATE.columnFilter]).includes(q);return columns.some(c=>clean(r[c]).includes(q));});}if(ASSET_STORE_STATE.sortColumn){const col=ASSET_STORE_STATE.sortColumn;rows.sort((a,b)=>String(a[col]??"").localeCompare(String(b[col]??""),"id",{numeric:true,sensitivity:'base'}));if(ASSET_STORE_STATE.sortDirection==='desc')rows.reverse();}return {rows,columns,headerError,totalSource};}
function renderAssetStoreTableOnly(){const host=document.getElementById("assetStoreDataSection");if(!host)return;const selected=ASSET_STORE_STATE.selectedSheet;const {rows,columns,headerError,totalSource}=getAssetStoreRows();const totalPage=Math.max(1,Math.ceil(rows.length/ASSET_STORE_STATE.pageSize));if(ASSET_STORE_STATE.page>totalPage)ASSET_STORE_STATE.page=totalPage;const start=(ASSET_STORE_STATE.page-1)*ASSET_STORE_STATE.pageSize;const pageRows=rows.slice(start,start+ASSET_STORE_STATE.pageSize);const activeSheetName=(ASSET_STORE_STATE.sheetList.find(s=>s.key===selected)||{}).name||selected||"Semua Sheet";const loadedTimes=(selected?[selected]:ASSET_STORE_STATE.sheetList.map(s=>s.key)).map(name=>ASSET_STORE_STATE.lastLoadedAt[name]).filter(Boolean).sort();const lastLoaded=loadedTimes.length?new Date(loadedTimes.at(-1)).toLocaleString("id-ID"):"-";if(ASSET_STORE_STATE.loadingList||ASSET_STORE_STATE.loadingData){host.innerHTML="<div class='card archive-section'><div class='state'>Memuat data sheet...</div></div>";return;}if(ASSET_STORE_STATE.dataError){host.innerHTML=`<div class='card archive-section'><div class='state'>${esc(ASSET_STORE_STATE.dataError)}</div></div>`;return;}if(headerError){host.innerHTML="<div class='card archive-section'><div class='state'>Header tidak terdeteksi</div></div>";return;}host.innerHTML=`<div class='card archive-section'><div class='grid dashboard archive-summary'><div class='metric'><div class='k'>Total Baris Asset</div><div class='v'>${totalSource}</div></div><div class='metric'><div class='k'>Total Kolom</div><div class='v'>${columns.length}</div></div><div class='metric'><div class='k'>Sheet Aktif</div><div class='v'>${esc(activeSheetName)}</div></div><div class='metric'><div class='k'>Terakhir Dimuat</div><div class='v'>${esc(lastLoaded)}</div></div></div></div><div class='card archive-section archive-table-card'>${!rows.length?"<div class='state'>Tidak ada data asset</div>":`<div class='table-wrap table-wrap-full archive-table-wrap'><table><thead><tr>${columns.map(c=>`<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${pageRows.map(r=>`<tr>${columns.map(c=>`<td>${esc(r[c]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class='mv-pagination'><span>Menampilkan ${rows.length?start+1:0}-${Math.min(start+ASSET_STORE_STATE.pageSize,rows.length)} dari ${rows.length}</span><div class='row'><button class='btn-ghost' data-asset-store-page='-1' ${ASSET_STORE_STATE.page<=1?'disabled':''}>Prev</button><button class='btn-ghost' data-asset-store-page='1' ${ASSET_STORE_STATE.page>=totalPage?'disabled':''}>Next</button></div></div>`}</div>`;}
function renderAssetStorePage(){if(!assetStoreApp)return;if(!ASSET_STORE_STATE.sheetList.length&&!ASSET_STORE_STATE.loadingList)ensureAssetStoreList();const selected=ASSET_STORE_STATE.selectedSheet;const {columns}=getAssetStoreRows();const sortOps=columns.map(c=>`<option value='${esc(c)}' ${ASSET_STORE_STATE.sortColumn===c?"selected":""}>${esc(c)}</option>`).join("");assetStoreApp.innerHTML=`<div class='archive-layout'><div class='card archive-section'><div class='section-header'><h3 class='page-title'>Asset Store</h3><div class='row'><select id='assetStoreSheetSelect'><option value=''>Semua Sheet</option>${ASSET_STORE_STATE.sheetList.map(s=>`<option value='${esc(s.key)}' ${s.key===selected?"selected":""}>${esc(s.name)}</option>`).join("")}</select><button id='assetStoreRefreshBtn' class='btn-ghost'>Refresh Asset Store</button></div></div>${ASSET_STORE_STATE.loadingList?"<div class='state'>Memuat daftar sheet...</div>":ASSET_STORE_STATE.listError?`<div class='state'>${esc(ASSET_STORE_STATE.listError)}</div>`:""}</div><div class='card archive-section archive-filter-card'><div class='mv-filters open archive-filters'><input id='assetStoreSearch' class='search-lg' placeholder='Cari di semua kolom (min. 2 huruf)' value='${esc(ASSET_STORE_STATE.searchInput)}'/><select id='assetStoreSortColumn'><option value=''>Urutkan Kolom</option>${sortOps}</select><select id='assetStoreSortDir'><option value='asc' ${ASSET_STORE_STATE.sortDirection==='asc'?'selected':''}>ASC</option><option value='desc' ${ASSET_STORE_STATE.sortDirection==='desc'?'selected':''}>DESC</option></select><select id='assetStoreColumnFilter'><option value='all'>Semua Kolom</option>${columns.map(c=>`<option value='${esc(c)}' ${ASSET_STORE_STATE.columnFilter===c?'selected':''}>Filter: ${esc(c)}</option>`).join('')}</select></div></div><div id='assetStoreDataSection'></div></div>`;renderAssetStoreTableOnly();}





async function updateHistoryRow(sheetKey,sheetName,rowNumber,values){const res=await fetch('/api/update-row',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({sheetKey,sheetName,rowNumber,values})});const data=await res.json();if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal update row');}
async function deleteHistoryRow(sheetKey,sheetName,rowNumber){const res=await fetch('/api/delete-row',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({sheetKey,sheetName,rowNumber})});const data=await res.json();if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal hapus row');}

const INLINE_EDIT_STATE={isEditing:false,editingRow:null,editingField:"",pendingSave:null,lastInputAt:0};
function createEditableCell(row,field,value,options){const td=document.createElement("td");td.className=`editable-cell ${options?.cellClass||""}`.trim();const rowNumber=Number(row?.rowNumber);const sheetName=getBalikanActiveSheetName(row);const state=getBalikanSaveStatus(rowNumber,field,sheetName);td.dataset.saveState=state?.status||"";td.title=state?.message||"";const display=value||"-";td.innerHTML=`${esc(display)}${state?.status==="saving"?"<span class='balikan-save-badge'>menyimpan</span>":state?.status==="queued"?"<span class='balikan-save-badge'>pending</span>":state?.status==="saved"?"<span class='balikan-save-badge saved'>tersimpan</span>":state?.status==="error"?"<span class='balikan-save-badge error'>gagal</span>":""}`;td.addEventListener("click",()=>{const latestValue=typeof options?.getLatestValue==="function"?options.getLatestValue({row,field,td}):row?.[field];startInlineEdit(td,row,field,latestValue,options);});return td;}
function startInlineEdit(cellEl,row,field,oldValue,options={}){const td=cellEl.closest('td')||cellEl;if(td.querySelector("input,select,textarea"))return;const saveDelayMs=Number(options.saveDelayMs||2000);const blurDelayMs=Number(options.blurDelayMs||1000);const showSaveButton=options.showSaveButton!==false;const input=document.createElement(options.multiline?"textarea":"input");const saveBtn=document.createElement("button");saveBtn.type="button";saveBtn.className="inline-edit-save-btn";saveBtn.textContent="Save";const prevValue=oldValue??"";input.value=String(prevValue);input.className="inline-edit-input inline-editor";td.classList.add("editing");td.innerHTML="";td.appendChild(input);if(showSaveButton)td.appendChild(saveBtn);input.focus();input.select();let cancelled=false,saving=false,pendingTimer=null,lastInputAt=0;INLINE_EDIT_STATE.isEditing=true;INLINE_EDIT_STATE.editingRow=Number(row?.rowNumber)||null;INLINE_EDIT_STATE.editingField=String(field||"");const clearPending=()=>{const timer=pendingTimer;if(timer){clearTimeout(timer);pendingTimer=null;}if(INLINE_EDIT_STATE.pendingSave===timer)INLINE_EDIT_STATE.pendingSave=null;};const finish=(value)=>{td.classList.remove("editing");td.textContent=value||"-";if(INLINE_EDIT_STATE.editingRow===(Number(row?.rowNumber)||null)&&INLINE_EDIT_STATE.editingField===String(field||"")){INLINE_EDIT_STATE.isEditing=false;INLINE_EDIT_STATE.editingRow=null;INLINE_EDIT_STATE.editingField="";clearPending();}};async function save(reason="manual"){if(cancelled||saving)return;const newValue=input.value.trim();if(newValue===String(prevValue)){options.onCancel?.({row,field,value:prevValue,td});finish(prevValue);return;}saving=true;try{await options.onSave?.({row,field,value:newValue,oldValue:prevValue,td,reason});if(row&&field)row[field]=newValue;finish(newValue);}catch(err){if(row&&field)row[field]=prevValue;options.onCancel?.({row,field,value:prevValue,td});finish(prevValue);toast(err?.message||"Gagal update data","error");}finally{saving=false;}}const queueAutoSave=(reason="typing")=>{clearPending();lastInputAt=Date.now();INLINE_EDIT_STATE.lastInputAt=lastInputAt;pendingTimer=setTimeout(()=>{if(cancelled||saving)return;const idleFor=Date.now()-lastInputAt;if(idleFor<saveDelayMs-50)return;save(reason);},saveDelayMs);INLINE_EDIT_STATE.pendingSave=pendingTimer;};input.addEventListener("input",()=>{options.onInput?.({row,field,value:input.value,td,input});queueAutoSave("typing-idle");});input.addEventListener("blur",()=>{clearPending();pendingTimer=setTimeout(()=>{if(cancelled||saving)return;save("blur-delay");},blurDelayMs);INLINE_EDIT_STATE.pendingSave=pendingTimer;});input.addEventListener("focus",()=>{clearPending();});if(showSaveButton)saveBtn.addEventListener("click",()=>save("button"));input.addEventListener("keydown",(e)=>{if(e.key==="Enter"&&(!options.multiline||e.ctrlKey||e.metaKey)){e.preventDefault();clearPending();save("enter");}if(e.key==="Escape"){cancelled=true;options.onCancel?.({row,field,value:prevValue,td});finish(prevValue);}});}
async function loadBalikanSheets(){try{const res=await fetch('/api/balikan-store/sheets');const data=await res.json();if(!res.ok)throw new Error(data?.message||'Gagal memuat daftar sheet');BALIKAN_STATE.sheets=Array.isArray(data?.sheets)?data.sheets.filter(n=>String(n||'').toUpperCase().includes('TRIP')):[];balikanSheetSelect.innerHTML='<option value="">Semua sheet TRIP</option>'+BALIKAN_STATE.sheets.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');if(!window.currentTripSheet)loadAllBalikanTripRows({background:true,force:true});}catch(err){toast(err?.message||'Gagal memuat daftar sheet','error');}}
function tagBalikanRows(rows=[],sheetName=""){return (Array.isArray(rows)?rows:[]).map(row=>({...row,sheetName:String(row?.sheetName||sheetName||'').trim()}));}
function getBalikanActiveSheetName(row=null){return String(row?.sheetName||window.currentTripSheet||'').trim();}
async function fetchBalikanSheetRows(sheetName,{force=false}={}){const sheet=String(sheetName||'').trim();if(!sheet)return {rows:[],dynamicColumns:[]};const cache=getBalikanRowsCache(sheet);if(cache&&!force){const rows=tagBalikanRows(cache.rows,sheet);BALIKAN_STATE.sheetCache[sheet]=rows;BALIKAN_STATE.dynamicColumnCache[sheet]=Array.isArray(cache.dynamicColumns)?cache.dynamicColumns:[];BALIKAN_STATE.sheetChecksums[sheet]=cache.checksum||checksumBalikanRows(rows,BALIKAN_STATE.dynamicColumnCache[sheet]);return {rows,dynamicColumns:BALIKAN_STATE.dynamicColumnCache[sheet],fromCache:true};}const res=await fetch(`/api/balikan-store?sheetName=${encodeURIComponent(sheet)}`,{cache:'no-store'});const data=await res.json();if(!res.ok)throw new Error(data?.message||`Gagal memuat data ${sheet}`);const rows=tagBalikanRows(Array.isArray(data?.rows)?data.rows:[],sheet);const dynamicColumns=Array.isArray(data?.dynamicColumns)?data.dynamicColumns:[];const checksum=checksumBalikanRows(rows,dynamicColumns);BALIKAN_STATE.sheetCache[sheet]=rows;BALIKAN_STATE.dynamicColumnCache[sheet]=dynamicColumns;BALIKAN_STATE.sheetChecksums[sheet]=checksum;setBalikanRowsCache(sheet,{rows,dynamicColumns,checksum,updatedAt:Date.now()});return {rows,dynamicColumns,fromCache:false};}
function mergeBalikanDynamicColumns(sheetNames=[]){const map=new Map();(sheetNames||[]).forEach(sheet=>{(BALIKAN_STATE.dynamicColumnCache[sheet]||[]).forEach(col=>{if(!map.has(col.key))map.set(col.key,col);});});return [...map.values()];}
function setBalikanDisplayRows(rows=[],dynamicColumns=[]){window.BALIKAN_ROWS=tagBalikanRows(rows);window.BALIKAN_DYNAMIC_COLUMNS=Array.isArray(dynamicColumns)?dynamicColumns:[];BALIKAN_STATE.lastDataChecksum=checksumBalikanRows(window.BALIKAN_ROWS,window.BALIKAN_DYNAMIC_COLUMNS);BALIKAN_STATE.lastRefreshAt=Date.now();setCacheSafe(MODULE_CACHE_KEYS.balikanStore,window.BALIKAN_ROWS);applyPendingBalikanEditsToRows();renderBalikanTable(true);}
async function loadAllBalikanTripRows(options={}){const {background=false,force=false,throwOnError=false}=options||{};if(BALIKAN_STATE.allTripLoading)return {skipped:true};if(!BALIKAN_STATE.sheets.length){if(!background){balikanSummary.textContent='';balikanTable.innerHTML='<div class="subtitle">Tidak ada sheet TRIP.</div>';}return {rows:0,failed:0};}BALIKAN_STATE.allTripLoading=true;if(!background){balikanSummary.textContent='Memuat index semua sheet TRIP...';}try{const results=await Promise.allSettled(BALIKAN_STATE.sheets.map(sheet=>fetchBalikanSheetRows(sheet,{force})));const failed=results.filter(r=>r.status==='rejected');if(failed.length===results.length&&throwOnError)throw failed[0].reason||new Error('Gagal memuat semua sheet TRIP');if(failed.length&&!background)toast(`${failed.length} sheet TRIP gagal dimuat`,'error');const allRows=BALIKAN_STATE.sheets.flatMap(sheet=>BALIKAN_STATE.sheetCache[sheet]||[]);setBalikanDisplayRows(allRows,mergeBalikanDynamicColumns(BALIKAN_STATE.sheets));return {rows:allRows.length,failed:failed.length};}catch(err){if(throwOnError)throw err;if(!background)toast(err?.message||'Gagal memuat semua sheet TRIP','error');return {rows:0,failed:BALIKAN_STATE.sheets.length,error:err};}finally{BALIKAN_STATE.allTripLoading=false;}}
async function loadBalikanRows(options={}){const {background=false,force=false,throwOnError=false}=options||{};if(!window.currentTripSheet){const result=await loadAllBalikanTripRows(options);if(throwOnError&&result?.error)throw result.error;return result;}if(BALIKAN_STATE.isRefreshing)return;try{BALIKAN_STATE.isRefreshing=true;if(balikanSortSelect)balikanSortSelect.value=BALIKAN_STATE.sortBy||'default';syncBalikanAutoCheckToggle();const {rows,dynamicColumns}=await fetchBalikanSheetRows(window.currentTripSheet,{force});setBalikanDisplayRows(rows,dynamicColumns);return rows;}catch(err){if(!background)toast(err?.message||'Gagal memuat data Balikan Store','error');if(throwOnError)throw err;}finally{BALIKAN_STATE.isRefreshing=false;}}
function hasBalikanUnfinishedLocalChange(){return INLINE_EDIT_STATE.isEditing||BALIKAN_STATE.saveInProgress||Object.keys(BALIKAN_STATE.pendingEdits||{}).length>0||!!balikanTable?.querySelector('.inline-edit-input');}
async function refreshBalikanStoreFull({background=true,force=true}={}){if(hasBalikanUnfinishedLocalChange())return {skipped:true,reason:'local-edit'};await loadBalikanRows({background,force});return {skipped:false,rows:Array.isArray(window.BALIKAN_ROWS)?window.BALIKAN_ROWS.length:0};}

function isCheckedValue(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return value === true || v === "true" || v === "1" || v === "yes" || v === "ya" || v === "checked" || v === "✓" || v === "☑";
}
function filterBalikanRows(rows,keyword){const q=String(keyword||"").toLowerCase().trim();if(!q)return rows;return rows.filter(row=>String(row.sku||"").toLowerCase().includes(q)||String(row.namaBarang||"").toLowerCase().includes(q)||String(row.lokasi||"").toLowerCase().includes(q)||String(row.status||"").toLowerCase().includes(q)||String(row.keterangan||"").toLowerCase().includes(q));}
function scrollToBalikanRow(rowNumber,sheetName=""){const el=document.getElementById(getBalikanDomRowId(rowNumber,sheetName));if(el)el.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"});}


function formatBalikanFieldName(field){const map={qty:'Qty',rakTujuan:'Rak Tujuan',lokasi:'Lokasi',stokBulky:'Stok Bulky',stokRetail:'Stok Retail',status:'Status',keterangan:'Keterangan'};return map[field]||field;}
const BALIKAN_BASE_COLUMNS=[['checked','CENTANG'],['sheetName','SHEET'],['no','NO'],['sku','SKU'],['namaBarang','NAMA BARANG'],['qty','QTY'],['rakTujuan','RAK TUJUAN'],['lokasi','LOKASI'],['stokBulky','STOK BULKY'],['stokRetail','STOK RETAIL'],['status','STATUS'],['keterangan','KETERANGAN']];
function getBalikanTableColumns(){const dynamic=(window.BALIKAN_DYNAMIC_COLUMNS||[]).map(col=>[col.key,col.header||col.key]);return [...BALIKAN_BASE_COLUMNS,...dynamic.filter(([key])=>!BALIKAN_BASE_COLUMNS.some(([baseKey])=>baseKey===key))];}
function getBalikanUniqueOptions(rows,col){const version=`${BALIKAN_STATE.lastDataChecksum}|${getBalikanTableColumns().map(([key])=>key).join('|')}`;if(BALIKAN_STATE.filterOptionsVersion!==version){BALIKAN_STATE.filterOptionsVersion=version;BALIKAN_STATE.filterOptionsByColumn={};}const cache=BALIKAN_STATE.filterOptionsByColumn||(BALIKAN_STATE.filterOptionsByColumn={});if(!cache[col])cache[col]=getUniqueOptions(rows,col,'balikan');return cache[col];}
function ensureBalikanFilterState(){if(!BALIKAN_STATE.filterState)BALIKAN_STATE.filterState={page:1,pageSize:50,openFilterCol:'',columnFilters:{},rows:[],filtered:[]};const st=BALIKAN_STATE.filterState;if(![25,50,100].includes(Number(st.pageSize)))st.pageSize=50;if(!Number.isFinite(Number(st.page))||Number(st.page)<1)st.page=1;getBalikanTableColumns().forEach(([k])=>{if(!Array.isArray(st.columnFilters[k]))st.columnFilters[k]=[];});return st;}
function getBalikanCacheKey(sheetName){return `${MODULE_CACHE_KEYS.balikanStore}:${String(sheetName||'default')}`;}
function checksumBalikanRows(rows=[],dynamicColumns=[]){try{return JSON.stringify({cols:(dynamicColumns||[]).map(c=>[c.key,c.header]),rows:(rows||[]).map(r=>[r.rowNumber,r.no,r.sku,r.namaBarang,r.qty,r.rakTujuan,r.lokasi,r.stokBulky,r.stokRetail,r.status,r.keterangan,r.checked,...(dynamicColumns||[]).map(c=>r?.[c.key])])});}catch(_err){return `${rows?.length||0}:${Date.now()}`;}}
function getBalikanRowsCache(sheetName){try{const parsed=JSON.parse(localStorage.getItem(getBalikanCacheKey(sheetName))||'null');return parsed&&Array.isArray(parsed.rows)?parsed:null;}catch(_err){return null;}}
function setBalikanRowsCache(sheetName,payload){try{localStorage.setItem(getBalikanCacheKey(sheetName),JSON.stringify(payload));}catch(_err){}}
function normalizeBalikanRawSearch(value){return String(value||"").toLowerCase().trim().replace(/\s+/g," ");}
function getBalikanSearchTokens(query){return normalizeBalikanRawSearch(query).split(' ').filter(Boolean);}
function getBalikanSkuBarcodeSearchValues(row){
  const values=[row?.sku,row?.barcode];
  Object.entries(row||{}).forEach(([key,value])=>{
    if(/barcode|sku|kode/i.test(key))values.push(value);
  });
  return values.map(normalizeBalikanRawSearch).filter(Boolean);
}
function matchesBalikanSkuBarcodeRaw(row,query){
  const q=normalizeBalikanRawSearch(query);
  if(!q)return false;
  return getBalikanSkuBarcodeSearchValues(row).some(value=>value.includes(q));
}
function normalizeBalikanLocationSearchValue(value){
  return decodeBalikanLocationValue(value)
    .toLowerCase()
    .trim()
    .replace(/[\u2010-\u2015]/g,'-')
    .replace(/[\/_]+/g,'-')
    .replace(/\s*-\s*/g,'-')
    .replace(/\s+/g,' ')
    .replace(/\s/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'');
}
function isBalikanLocationSearchQuery(query){
  const raw=String(query||'').trim();
  const normalized=normalizeBalikanLocationSearchValue(raw);
  if(!normalized)return false;
  if(/\b(area|ruang|rak|bin|hold|tr)\b/i.test(raw))return true;
  if(/[\s\-\/_]/.test(raw)&&/[a-z]/i.test(raw)&&/\d/.test(raw))return true;
  return /^[a-z]{1,6}\d{1,4}-\d/.test(normalized)||/^[a-z]{1,6}-\d{1,4}(?:-[a-z0-9]+)+$/i.test(normalized);
}
function getBalikanRowLocationSearchValues(row){
  const parts=splitBalikanLocationNames(row?.lokasi);
  const values=parts.length?parts:[row?.lokasi];
  return values.map(normalizeBalikanLocationSearchValue).filter(Boolean);
}
function isBalikanPartialLocationQuery(queryNormalized){
  return String(queryNormalized||'').split('-').filter(Boolean).length<=2;
}
function matchesBalikanLocationQuery(row,queryNormalized){
  if(!queryNormalized)return true;
  const allowPartial=isBalikanPartialLocationQuery(queryNormalized);
  return getBalikanRowLocationSearchValues(row).some(location=>location===queryNormalized||(allowPartial&&(location.startsWith(`${queryNormalized}-`)||location.includes(queryNormalized))));
}
function getBalikanSearchText(row){return normalizeSearch(`${row?.sku??''} ${row?.barcode??''} ${row?.namaBarang??''} ${row?.lokasi??''} ${row?.status??''} ${row?.keterangan??''} ${Object.values(row||{}).join(' ')}`);}
function applyBalikanTableFilters(rows,mode='balikan',omitCol=''){const st=ensureBalikanFilterState();const rawQuery=window.balikanSearchKeyword||'';const q=normalizeBalikanRawSearch(rawQuery);const qTokens=getBalikanSearchTokens(q);const isLocationQuery=isBalikanLocationSearchQuery(rawQuery)&&qTokens.length===1;const locationQuery=normalizeBalikanLocationSearchValue(rawQuery);const exactScanSku=normalizeBalikanRawSearch(BALIKAN_STATE.exactScanSku||'');const selectedSku=normalizeBalikanRawSearch(BALIKAN_STATE.selectedSkuValue||'');return rows.filter(r=>{if(getBalikanTableColumns().some(([col])=>{if(col===omitCol)return false;const selected=st.columnFilters[col]||[];if(!selected.length)return false;return !selected.includes(sanitizeFilterValue(getFilterRowValue(r,col,'balikan')));}))return false;if(exactScanSku&&normalizeBalikanRawSearch(r.sku)!==exactScanSku)return false;if(selectedSku&&q===selectedSku&&normalizeBalikanRawSearch(r.sku)!==selectedSku)return false;if(qTokens.length){if(matchesBalikanSkuBarcodeRaw(r,q))return true;if(isLocationQuery){if(!matchesBalikanLocationQuery(r,locationQuery))return false;}else{const rowText=getBalikanSearchText(r);if(!qTokens.every(token=>rowText.includes(token)))return false;}}return true;});}



function toNumberSafe(value){
  const parsed=Number(String(value??'').replace(/[^0-9.-]/g,''));
  return Number.isFinite(parsed)?parsed:0;
}
function decodeBalikanLocationValue(locationValue){
  const raw=String(locationValue??'').trim();
  if(!raw)return '';
  if(!/%[0-9A-Fa-f]{2}/.test(raw))return raw;
  try{return decodeURIComponent(raw).trim();}
  catch(_err){return raw;}
}
function normalizeBalikanLocation(locationValue){
  return clean(decodeBalikanLocationValue(locationValue));
}
function splitBalikanLocationNames(lokasiValue){
  return decodeBalikanLocationValue(lokasiValue)
    .split(/\r?\n|[;,|/]+|\s+dan\s+/i)
    .map(part=>decodeBalikanLocationValue(part))
    .filter(Boolean);
}
function buildBalikanLocationStockIndex(){
  const stockIndex=new Map();
  (DATA["Kartu Stock"]||[]).forEach(row=>{
    const skuKey=clean(getVal(row,["sku"]));
    if(!skuKey)return;
    const qty=toNumberSafe(getVal(row,["stok akhir","closing stock","ending stock","saldo akhir","qty","stok","quantity"]));
    splitBalikanLocationNames(getVal(row,["lokasi","location","rak","bin","area"])).forEach(lokasi=>{
      const key=`${skuKey}|${normalizeBalikanLocation(lokasi)}`;
      stockIndex.set(key,(stockIndex.get(key)||0)+qty);
    });
  });
  return stockIndex;
}
function getBalikanLocationSummary(rows=[]){
  const totals=new Map();
  const countedSkuLocations=new Set();
  const stockIndex=buildBalikanLocationStockIndex();
  (rows||[]).forEach(row=>{
    const sku=String(row?.sku??'').trim();
    const skuKey=clean(sku);
    if(!skuKey)return;
    splitBalikanLocationNames(row?.lokasi).forEach(lokasi=>{
      const lokasiKey=normalizeBalikanLocation(lokasi);
      const countedKey=`${skuKey}|${lokasiKey}`;
      if(!lokasiKey||countedSkuLocations.has(countedKey))return;
      countedSkuLocations.add(countedKey);
      totals.set(lokasi,(totals.get(lokasi)||0)+(stockIndex.get(countedKey)||0));
    });
  });
  return [...totals.entries()].map(([lokasi,qty])=>({lokasi,qty})).sort((a,b)=>b.qty-a.qty||a.lokasi.localeCompare(b.lokasi,'id'));
}
function getBalikanSkuLocationOptions(row){
  const skuKey=clean(row?.sku);
  const locations=new Map();
  const addLocation=(lokasi,qty=0)=>{
    const rawLocation=decodeBalikanLocationValue(lokasi);
    const displayLabel=rawLocation;
    const key=normalizeBalikanLocation(rawLocation);
    if(!key)return;
    const existing=locations.get(key);
    if(existing){
      existing.qty+=toNumberSafe(qty);
      return;
    }
    locations.set(key,{lokasi:displayLabel,rawLocation,displayLabel,qty:toNumberSafe(qty)});
  };
  if(skuKey){
    (DATA["Kartu Stock"]||[]).forEach(stockRow=>{
      if(clean(getVal(stockRow,["sku"]))!==skuKey)return;
      const qty=toNumberSafe(getVal(stockRow,["stok akhir","closing stock","ending stock","saldo akhir","qty","stok","quantity"]));
      splitBalikanLocationNames(getVal(stockRow,["lokasi","location","rak","bin","area"])).forEach(lokasi=>addLocation(lokasi,qty));
    });
  }
  splitBalikanLocationNames(row?.lokasi).forEach(lokasi=>addLocation(lokasi,0));
  return [...locations.values()].sort((a,b)=>b.qty-a.qty||a.lokasi.localeCompare(b.lokasi,'id'));
}
function getBalikanLocationCardRow(rows=[]){
  const list=Array.isArray(rows)?rows:[];
  const selectedRowNumber=Number(BALIKAN_STATE.selectedSkuRowNumber)||0;
  if(selectedRowNumber){
    const selected=list.find(row=>Number(row?.rowNumber)===selectedRowNumber&&(!BALIKAN_STATE.selectedSkuSheetName||getBalikanActiveSheetName(row)===BALIKAN_STATE.selectedSkuSheetName));
    if(selected)return selected;
  }
  return list.length===1?list[0]:null;
}
function isBalikanLocationRowSelected(row){
  if(!row)return false;
  const st=ensureBalikanFilterState();
  const visibleRows=Array.isArray(st.filtered)?st.filtered:[];
  if(visibleRows.length===1){
    const single=visibleRows[0];
    return Number(row?.rowNumber)===Number(single?.rowNumber)&&getBalikanActiveSheetName(row)===getBalikanActiveSheetName(single);
  }
  const selectedRowNumber=Number(BALIKAN_STATE.selectedSkuRowNumber)||0;
  if(!selectedRowNumber)return false;
  return Number(row?.rowNumber)===selectedRowNumber&&(!BALIKAN_STATE.selectedSkuSheetName||getBalikanActiveSheetName(row)===BALIKAN_STATE.selectedSkuSheetName);
}
function getBalikanStatusBadgeClass(status){
  const normalized=clean(status);
  if(normalized==='sesuai')return 'is-sesuai';
  if(normalized==='lebih kirim')return 'is-lebih-kirim';
  if(normalized==='kurang kirim')return 'is-kurang-kirim';
  return '';
}
function renderBalikanStatusBadge(row){
  if(!isBalikanLocationRowSelected(row))return '';
  const status=String(row?.status??'').trim();
  const cls=getBalikanStatusBadgeClass(status);
  if(!status||!cls)return '';
  return `<span class='balikan-status-badge ${cls}'>${esc(status)}</span>`;
}
function renderBalikanLocationCardContent(rows=[]){
  const list=Array.isArray(rows)?rows:[];
  const row=getBalikanLocationCardRow(list);
  if(!row){
    const count=list.length;
    const bySheet=new Map();
    list.forEach(item=>{const sheet=getBalikanActiveSheetName(item)||'-';if(clean(item?.lokasi))bySheet.set(sheet,(bySheet.get(sheet)||0)+1);});
    const sheetHtml=[...bySheet.entries()].map(([sheet,total])=>`<div class='balikan-location-sheet-row'><span class='balikan-sheet-badge'>${esc(sheet)}</span><strong>${total} lokasi</strong></div>`).join('');
    return `<div class='k'>Lokasi</div><div class='v'>${count?`${count} lokasi ditemukan`:'Pilih 1 SKU dulu'}</div><div class='subtitle'>${count?'Seluruh hasil tampil dihitung lintas sheet. Tap SKU di tabel untuk memilih row sebelum update lokasi.':'Tidak ada baris hasil pencarian.'}</div>${sheetHtml?`<div class='balikan-location-sheet-list'>${sheetHtml}</div>`:''}`;
  }
  const locations=getBalikanSkuLocationOptions(row);
  if(!locations.length)return `<div class='k'>Lokasi</div><div class='v'>Tidak ada lokasi</div><div class='subtitle'>Lokasi kosong tidak bisa dipilih.</div>`;
  const activeKey=normalizeBalikanLocation(row?.lokasi);
  const hasActive=locations.some(item=>normalizeBalikanLocation(item.rawLocation||item.lokasi)===activeKey);
  const canUpdate=getPermissions().canUpdate!==false;
  const sheetBadge=`<span class='balikan-sheet-badge'>${esc(getBalikanActiveSheetName(row)||'-')}</span>`;
  const statusBadge=renderBalikanStatusBadge(row);
  const selectedMeta=isBalikanLocationRowSelected(row)?`${sheetBadge}${statusBadge}`:sheetBadge;
  return `<div class='k'>Lokasi</div><div class='v balikan-location-title'><span>${esc(row.sku||'-')}</span> ${selectedMeta}</div><div class='subtitle'>${locations.length} lokasi ditemukan. Tap lokasi untuk update kolom LOKASI.</div><div class='balikan-location-list'>${locations.map(item=>{
    const displayLabel=decodeBalikanLocationValue(item.displayLabel||item.lokasi);
    const rawLocation=decodeBalikanLocationValue(item.rawLocation||item.lokasi);
    const itemKey=normalizeBalikanLocation(rawLocation);
    const active=hasActive&&itemKey===activeKey;
    const inactive=hasActive&&!active;
    return `<button type='button' class='balikan-location-item ${active?'is-active':''} ${inactive?'is-inactive':''}' data-balikan-location-select='1' data-row-number='${Number(row.rowNumber)||0}' data-location='${esc(rawLocation)}' ${!itemKey||!canUpdate?'disabled':''} aria-pressed='${active?'true':'false'}'><span class='balikan-location-name'>${esc(displayLabel)} :</span><strong>${item.qty} pcs</strong></button>`;
  }).join('')}</div>`;
}
function getBalikanInventFieldKey(){
  const cols=Array.isArray(window.BALIKAN_DYNAMIC_COLUMNS)?window.BALIKAN_DYNAMIC_COLUMNS:[];
  const found=cols.find(col=>clean(col?.header)==='invent'||clean(col?.key)==='invent');
  return found?.key||'invent';
}
function isBalikanInventField(field){
  const normalized=clean(field);
  if(normalized==='invent')return true;
  const cols=Array.isArray(window.BALIKAN_DYNAMIC_COLUMNS)?window.BALIKAN_DYNAMIC_COLUMNS:[];
  return cols.some(col=>String(col?.key||'')===String(field||'')&&clean(col?.header)==='invent');
}
function getBalikanInventValue(row){
  if(!row)return '';
  const direct=String(row?.invent??'').trim();
  if(direct)return direct;
  const key=getBalikanInventFieldKey();
  return String(row?.[key]??'').trim();
}
function renderBalikanKeteranganCardContent(rows=[]){
  const list=Array.isArray(rows)?rows:[];
  const row=getBalikanLocationCardRow(list);
  const text=String(row?.keterangan??'').trim();
  return `<div class='k'>Keterangan</div><div class='v balikan-keterangan-value ${text?'':'is-empty'}'>${text?esc(text):'Tidak ada keterangan'}</div>`;
}
function renderBalikanInventCardContent(rows=[]){
  const list=Array.isArray(rows)?rows:[];
  const row=getBalikanLocationCardRow(list);
  const value=getBalikanInventValue(row);
  return `<div class='k'>Invent</div><div class='v balikan-invent-value ${value?'':'is-empty'}'>${value?esc(value):'-'}</div>`;
}
function updateBalikanLocationCard(rows=[]){
  const card=document.getElementById('balikanLocationCard');
  if(!card)return;
  card.innerHTML=renderBalikanLocationCardContent(rows);
}
function updateBalikanKeteranganCard(rows=[]){
  const card=document.getElementById('balikanKeteranganCard');
  if(!card)return;
  card.innerHTML=renderBalikanKeteranganCardContent(rows);
}
function updateBalikanInventCard(rows=[]){
  const card=document.getElementById('balikanInventCard');
  if(!card)return;
  card.innerHTML=renderBalikanInventCardContent(rows);
}
function updateBalikanSummaryCardsFromCurrentRows(){
  const st=ensureBalikanFilterState();
  const baseRows=(window.BALIKAN_ROWS||[]).map(r=>({...r}));
  const rows=sortBalikanRows(applyBalikanTableFilters(baseRows),BALIKAN_STATE.sortBy||'default');
  st.rows=baseRows;
  st.filtered=rows;
  renderBalikanSummaryInfo(rows,baseRows);
}
function updateBalikanLocationCardFromCurrentRows(){
  updateBalikanSummaryCardsFromCurrentRows();
}

function parseBalikanSkuSequence(value){
  const text=String(value??'');
  const match=text.match(/^(.*?)(\d+)$/);
  if(!match)return null;
  return {prefix:match[1],digits:match[2],value:BigInt(match[2])};
}
function syncBalikanSkuStepper(){
  const input=document.querySelector('#balikanSearchInput')||balikanSearchInput;
  const sequence=parseBalikanSkuSequence(input?.value||'');
  document.querySelectorAll('#page-balikan-store [data-balikan-sku-step]').forEach(button=>{
    const delta=BigInt(Number(button.dataset.balikanSkuStep)||0);
    const nextValue=sequence?sequence.value+delta:0n;
    const upperLimit=sequence?10n**BigInt(sequence.digits.length):0n;
    button.disabled=!sequence||nextValue<0n||nextValue>=upperLimit;
  });
}
function stepBalikanSku(delta){
  const input=document.querySelector('#balikanSearchInput')||balikanSearchInput;
  const sequence=parseBalikanSkuSequence(input?.value||'');
  if(!input||!sequence)return;
  const nextValue=sequence.value+BigInt(delta);
  if(nextValue<0n||nextValue>=10n**BigInt(sequence.digits.length))return;
  const keyword=sequence.prefix+nextValue.toString().padStart(sequence.digits.length,'0');
  input.value=keyword;
  window.balikanSearchKeyword=keyword;
  BALIKAN_STATE.exactScanSku='';
  BALIKAN_STATE.selectedSkuRowNumber=null;
  BALIKAN_STATE.selectedSkuSheetName='';
  BALIKAN_STATE.selectedSkuValue='';
  const baseRows=(window.BALIKAN_ROWS||[]).map(row=>({...row}));
  const matches=sortBalikanRows(applyBalikanTableFilters(baseRows),BALIKAN_STATE.sortBy||'default');
  if(matches.length===1){
    const row=matches[0];
    BALIKAN_STATE.selectedSkuRowNumber=Number(row.rowNumber)||null;
    BALIKAN_STATE.selectedSkuSheetName=getBalikanActiveSheetName(row);
    BALIKAN_STATE.selectedSkuValue=String(row.sku||'').trim();
  }
  clearTimeout(BALIKAN_STATE.searchDebounceTimer);
  saveBalikanSearchHistory(keyword);
  syncBalikanSkuStepper();
  renderBalikanTable(true);
  window.setTimeout(()=>input.focus(),0);
}

function getBalikanSearchHistory(){try{const raw=localStorage.getItem(CACHE_KEYS.balikanSearchHistory);const list=JSON.parse(raw||"[]");return Array.isArray(list)?list.map(item=>String(item||"").trim()).filter(Boolean).slice(0,10):[];}catch(_err){return [];}}
function renderBalikanSearchHistory(){const wrap=document.getElementById("balikanSearchHistory");if(!wrap)return;const items=getBalikanSearchHistory();if(!items.length){wrap.innerHTML="";return;}wrap.innerHTML=`<div class='balikan-history-head'><span>History pencarian</span><button class='btn-ghost balikan-history-clear' type='button' data-balikan-history-clear>Clear history</button></div><div class='balikan-history-chips'>${items.map(item=>`<button class='balikan-history-chip' type='button' data-balikan-history='${encAttr(item)}'><span>${esc(item)}</span><span class='balikan-history-remove' role='button' tabindex='-1' aria-label='Hapus ${esc(item)}' data-balikan-history-remove='${encAttr(item)}'>×</span></button>`).join("")}</div>`;}
function saveBalikanSearchHistory(query){const q=String(query||"").trim();if(!q)return;const items=[q,...getBalikanSearchHistory().filter(item=>clean(item)!==clean(q))].slice(0,10);try{localStorage.setItem(CACHE_KEYS.balikanSearchHistory,JSON.stringify(items));}catch(_err){}renderBalikanSearchHistory();}
function removeBalikanSearchHistory(query){const q=String(query||"").trim();const items=getBalikanSearchHistory().filter(item=>clean(item)!==clean(q));try{localStorage.setItem(CACHE_KEYS.balikanSearchHistory,JSON.stringify(items));}catch(_err){}renderBalikanSearchHistory();}
function clearBalikanSearchHistory(){try{localStorage.removeItem(CACHE_KEYS.balikanSearchHistory);}catch(_err){}renderBalikanSearchHistory();}
function applyBalikanSearchHistory(query){const q=String(query||"").trim();if(!q)return;window.balikanSearchKeyword=q;BALIKAN_STATE.exactScanSku="";BALIKAN_STATE.selectedSkuRowNumber=null;BALIKAN_STATE.selectedSkuSheetName="";BALIKAN_STATE.selectedSkuValue="";const input=document.querySelector("#balikanSearchInput")||balikanSearchInput;if(input){input.value=q;input.focus();}syncBalikanSkuStepper();saveBalikanSearchHistory(q);renderBalikanTable(false);}

function getBalikanVisibleLocationTargetRow(){
  const baseRows=(window.BALIKAN_ROWS||[]).map(r=>({...r}));
  const rows=sortBalikanRows(applyBalikanTableFilters(baseRows),BALIKAN_STATE.sortBy||'default');
  return getBalikanLocationCardRow(rows);
}
function selectBalikanSkuRow(rowNumber,sheetName=""){
  const nextRow=Number(rowNumber)||null;
  const nextSheet=String(sheetName||'').trim();
  if(!nextRow)return;
  const selectedRow=(window.BALIKAN_ROWS||[]).find(row=>Number(row?.rowNumber)===nextRow&&(!nextSheet||getBalikanActiveSheetName(row)===nextSheet));
  const sku=String(selectedRow?.sku??'').trim();
  if(!sku)return;
  const prevRow=Number(BALIKAN_STATE.selectedSkuRowNumber)||null;
  const prevSheet=String(BALIKAN_STATE.selectedSkuSheetName||'');
  if(prevRow&&(prevRow!==nextRow||prevSheet!==nextSheet)){
    document.getElementById(getBalikanDomRowId(prevRow,prevSheet))?.classList.remove('balikan-row-selected-sku');
  }
  BALIKAN_STATE.selectedSkuRowNumber=nextRow;
  BALIKAN_STATE.selectedSkuSheetName=getBalikanActiveSheetName(selectedRow);
  BALIKAN_STATE.selectedSkuValue=sku;
  BALIKAN_STATE.exactScanSku='';
  window.balikanSearchKeyword=sku;
  const searchInput=document.querySelector('#balikanSearchInput')||balikanSearchInput;
  if(searchInput)searchInput.value=sku;
  saveBalikanSearchHistory(sku);
  const nextEl=document.getElementById(getBalikanDomRowId(nextRow,BALIKAN_STATE.selectedSkuSheetName));
  if(nextEl)nextEl.classList.add('balikan-row-selected-sku');
  renderBalikanTable(true);
  window.setTimeout(()=>scrollToBalikanRow(nextRow,BALIKAN_STATE.selectedSkuSheetName),0);
}
async function handleBalikanLocationSelect(btn){
  const rawLocation=decodeBalikanLocationValue(btn?.dataset?.location||'');
  const location=rawLocation;
  if(!location){
    toast('Lokasi kosong tidak bisa dipilih.','error');
    return;
  }
  const row=getBalikanVisibleLocationTargetRow();
  if(!row){
    toast('Pilih 1 SKU dulu','error');
    updateBalikanLocationCardFromCurrentRows();
    return;
  }
  const oldValue=String(row.lokasi??'');
  if(normalizeBalikanLocation(oldValue)===normalizeBalikanLocation(location)){
    updateBalikanLocationCardFromCurrentRows();
    return;
  }
  btn.disabled=true;
  try{
    await updateBalikanCell(getBalikanActiveSheetName(row),row,'lokasi',location,oldValue);
    updateBalikanLocationCardFromCurrentRows();
    showToast(`Lokasi aktif diubah ke ${location}`,'success');
  }catch(err){
    toast(err?.message||'Gagal memilih lokasi','error');
    updateBalikanLocalRow(row.rowNumber,'lokasi',oldValue);
    updateBalikanCellText(row.rowNumber,'lokasi',oldValue);
    updateBalikanLocationCardFromCurrentRows();
  }finally{
    btn.disabled=false;
  }
}
function renderBalikanSummaryInfo(rows,baseRows){
  if(!balikanSummary)return;
  const totalRows=baseRows.length;
  const visibleRows=rows.length;
  const checkedCount=rows.filter(r=>isCheckedValue(r.checked)).length;
  const uncheckedCount=Math.max(0,visibleRows-checkedCount);
  const checkedPct=visibleRows?((checkedCount/visibleRows)*100):0;
  const totalQty=rows.reduce((sum,r)=>sum+toNumberSafe(r.qty),0);
  const sheetCount=new Set(rows.map(r=>getBalikanActiveSheetName(r)).filter(Boolean)).size;
  const progressState=checkedPct>=80?'high':checkedPct>=50?'medium':'low';
  balikanSummary.innerHTML=`<div class='grid dashboard archive-summary balikan-summary-grid balikan-summary-compact'>    <div class='metric'><div class='k'>Baris Ditampilkan</div><div class='v'>${visibleRows}</div></div>    <div class='metric balikan-metric-progress'><div class='k'>Checklist</div><div class='v'>${checkedCount} (${checkedPct.toFixed(1)}%)</div></div>    <div class='metric'><div class='k'>Belum Checklist</div><div class='v'>${uncheckedCount}</div></div>    <div class='metric'><div class='k'>Total Qty</div><div class='v'>${totalQty}</div></div>    <div id='balikanKeteranganCard' class='metric balikan-keterangan-card' aria-live='polite'>${renderBalikanKeteranganCardContent(rows)}</div>    <div id='balikanInventCard' class='metric balikan-invent-card' aria-live='polite'>${renderBalikanInventCardContent(rows)}</div>    <div id='balikanLocationCard' class='metric balikan-location-card' aria-live='polite'>${renderBalikanLocationCardContent(rows)}</div>  </div><div class='balikan-progress-track balikan-progress-${progressState}' role='progressbar' aria-label='Progress checklist Balikan Store' aria-valuemin='0' aria-valuemax='100' aria-valuenow='${checkedPct.toFixed(1)}'><span class='balikan-progress-fill' style='width:${checkedPct.toFixed(1)}%'></span></div>`;
}

function syncBalikanAutoCheckToggle(){if(!balikanAutoCheckToggle)return;const perms=getPermissions();const isOn=BALIKAN_STATE.autoCheckOnScan!==false;balikanAutoCheckToggle.checked=isOn;balikanAutoCheckToggle.setAttribute("aria-checked",isOn?"true":"false");const statusEl=document.getElementById("balikanAutoCheckStatus");if(statusEl)statusEl.textContent=isOn?"ON":"OFF";const wrap=balikanAutoCheckToggle.closest(".balikan-switch-wrap");if(wrap){wrap.classList.toggle("is-on",isOn);wrap.classList.toggle("is-off",!isOn);wrap.style.display=perms.canUpdate?"":"none";}}
function initBalikanAutoCheckPreference(){try{const saved=localStorage.getItem(BALIKAN_AUTO_CHECK_KEY);if(saved===null)return;BALIKAN_STATE.autoCheckOnScan=saved!=="0";}catch(_err){}}
function toggleBalikanAutoCheck(isOn){const next=typeof isOn==="boolean"?isOn:!(BALIKAN_STATE.autoCheckOnScan!==false);BALIKAN_STATE.autoCheckOnScan=next;try{localStorage.setItem(BALIKAN_AUTO_CHECK_KEY,next?"1":"0");}catch(_err){}syncBalikanAutoCheckToggle();}
function sortBalikanRows(rows,sortBy='default'){const list=[...rows];const map={default:(a,b)=>(Number(a.rowNumber)||0)-(Number(b.rowNumber)||0),skuAsc:(a,b)=>String(a.sku||'').localeCompare(String(b.sku||'')),skuDesc:(a,b)=>String(b.sku||'').localeCompare(String(a.sku||'')),namaAsc:(a,b)=>String(a.namaBarang||'').localeCompare(String(b.namaBarang||'')),namaDesc:(a,b)=>String(b.namaBarang||'').localeCompare(String(a.namaBarang||'')),qtyDesc:(a,b)=>parseNumber(b.qty)-parseNumber(a.qty),qtyAsc:(a,b)=>parseNumber(a.qty)-parseNumber(b.qty),checkedFirst:(a,b)=>Number(isCheckedValue(b.checked))-Number(isCheckedValue(a.checked)),uncheckedFirst:(a,b)=>Number(isCheckedValue(a.checked))-Number(isCheckedValue(b.checked))};return list.sort(map[sortBy]||map.default);}
function resetBalikanSearch(){
  clearTimeout(BALIKAN_STATE.searchDebounceTimer);
  window.balikanSearchKeyword='';
  Object.assign(BALIKAN_STATE,{exactScanSku:'',highlightRowNumber:null,highlightSheetName:'',selectedSkuRowNumber:null,selectedSkuSheetName:'',selectedSkuValue:''});
  ensureBalikanFilterState().page=1;
  if(balikanSearchInput)balikanSearchInput.value='';
  syncBalikanSkuStepper();
  renderBalikanTable(false);
}
function exportBalikanFilteredCsv(){const st=ensureBalikanFilterState();const baseRows=(window.BALIKAN_ROWS||[]).map(r=>({...r}));const filtered=sortBalikanRows(applyBalikanTableFilters(baseRows),BALIKAN_STATE.sortBy||'default');const dynamicCols=Array.isArray(window.BALIKAN_DYNAMIC_COLUMNS)?window.BALIKAN_DYNAMIC_COLUMNS:[];const cols=['no','sku','namaBarang','qty','rakTujuan','lokasi','stokBulky','stokRetail','status','keterangan',...dynamicCols.map(c=>c.key),'checked'];const header=['No','SKU','Nama Barang','Qty','Rak Tujuan','Lokasi','Stok Bulky','Stok Retail','Status','Keterangan',...dynamicCols.map(c=>c.header),'Centang'];const lines=[header.join(','),...filtered.map(row=>cols.map(c=>`"${String(row[c]??'').replaceAll('"','""')}"`).join(','))];const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);const sheet=String(window.currentTripSheet||'balikan-store').replace(/[^a-z0-9-_]+/gi,'-');a.download=`${sheet}-filtered.csv`;a.click();URL.revokeObjectURL(a.href);toast('Export CSV berhasil','success');logActivitySafe({action:'EXPORT_CSV_BALIKAN',module:'Balikan Store',detail:`Export CSV ${filtered.length} baris`,status:'SUCCESS'});}
function getBalikanEditKey(rowNumber,field,sheetName=""){return `${String(sheetName||window.currentTripSheet||'')}:${Number(rowNumber)}:${String(field||"")}`;}
function setBalikanSaveStatus(rowNumber,field,status,message="",sheetName=""){const key=getBalikanEditKey(rowNumber,field,sheetName);if(status)BALIKAN_STATE.saveStatus[key]={status,message};else delete BALIKAN_STATE.saveStatus[key];updateBalikanCellState(rowNumber,field,sheetName);}
function getBalikanSaveStatus(rowNumber,field,sheetName=""){return BALIKAN_STATE.saveStatus[getBalikanEditKey(rowNumber,field,sheetName)]||null;}
function updateBalikanLocalRow(rowNumber,field,value,sheetName=""){const targetSheet=String(sheetName||window.currentTripSheet||'').trim();const apply=(list)=>{if(!Array.isArray(list))return;const target=list.find(item=>Number(item.rowNumber)===Number(rowNumber)&&(!targetSheet||getBalikanActiveSheetName(item)===targetSheet));if(target&&field)target[field]=value;};apply(window.BALIKAN_ROWS);const st=ensureBalikanFilterState();apply(st.rows);if(targetSheet&&Array.isArray(BALIKAN_STATE.sheetCache[targetSheet])){apply(BALIKAN_STATE.sheetCache[targetSheet]);setBalikanRowsCache(targetSheet,{rows:BALIKAN_STATE.sheetCache[targetSheet],dynamicColumns:BALIKAN_STATE.dynamicColumnCache[targetSheet]||[],checksum:checksumBalikanRows(BALIKAN_STATE.sheetCache[targetSheet],BALIKAN_STATE.dynamicColumnCache[targetSheet]||[]),updatedAt:Date.now()});}BALIKAN_STATE.lastDataChecksum=checksumBalikanRows(window.BALIKAN_ROWS||[],window.BALIKAN_DYNAMIC_COLUMNS||[]);BALIKAN_STATE.filterOptionsVersion='';setCacheSafe(MODULE_CACHE_KEYS.balikanStore,window.BALIKAN_ROWS||[]);if(field)updateBalikanSummaryCardsFromCurrentRows();}
function applyPendingBalikanEditsToRows(){const pending=BALIKAN_STATE.pendingEdits||{};Object.entries(pending).forEach(([sheetName,byRow])=>{Object.entries(byRow||{}).forEach(([rowNumber,fields])=>{Object.entries(fields||{}).forEach(([field,value])=>updateBalikanLocalRow(rowNumber,field,value,sheetName));});});}
function renderBalikanTableWhenIdle(){if(balikanTable?.querySelector('.inline-edit-input')){setTimeout(renderBalikanTableWhenIdle,100);return;}renderBalikanTable(true);}
function queueBalikanSave(delayMs=350){if(BALIKAN_STATE.saveTimer)clearTimeout(BALIKAN_STATE.saveTimer);BALIKAN_STATE.saveTimer=setTimeout(()=>flushBalikanPendingEdits(),delayMs);}
function queueBalikanEdit(sheetName,row,field,value,oldValue){const rowNumber=Number(row?.rowNumber);if(!Number.isInteger(rowNumber)||rowNumber<=1)throw new Error('rowNumber tidak valid');const targetSheet=String(sheetName||getBalikanActiveSheetName(row)||'').trim();if(!targetSheet)throw new Error('Sheet Balikan Store belum dipilih');if(!BALIKAN_STATE.pendingEdits[targetSheet])BALIKAN_STATE.pendingEdits[targetSheet]={};if(!BALIKAN_STATE.pendingEdits[targetSheet][rowNumber])BALIKAN_STATE.pendingEdits[targetSheet][rowNumber]={};BALIKAN_STATE.pendingEdits[targetSheet][rowNumber][field]=value;const key=getBalikanEditKey(rowNumber,field,targetSheet);if(!BALIKAN_STATE.pendingEditMeta[key])BALIKAN_STATE.pendingEditMeta[key]={oldValue,rowSnapshot:{sku:row?.sku||'',sheetName:targetSheet}};BALIKAN_STATE.pendingEditMeta[key]={...BALIKAN_STATE.pendingEditMeta[key],sheetName:targetSheet,rowNumber,field,value};setBalikanSaveStatus(rowNumber,field,'queued','Menunggu disimpan',targetSheet);updateBalikanLocalRow(rowNumber,field,value,targetSheet);updateBalikanCellText(rowNumber,field,value,targetSheet);queueBalikanSave();setTimeout(renderBalikanTableWhenIdle,0);}
async function flushBalikanPendingEdits(){if(BALIKAN_STATE.saveInProgress){BALIKAN_STATE.saveRequested=true;return;}const pending=BALIKAN_STATE.pendingEdits||{};const batches=Object.entries(pending).map(([sheetName,byRow])=>({sheetName,edits:Object.entries(byRow||{}).map(([rowNumber,updates])=>({rowNumber:Number(rowNumber),updates:{...(updates||{})}})).filter(edit=>Number.isInteger(edit.rowNumber)&&Object.keys(edit.updates).length)})).filter(batch=>batch.sheetName&&batch.edits.length);if(!batches.length)return;BALIKAN_STATE.saveInProgress=true;BALIKAN_STATE.saveRequested=false;batches.forEach(batch=>batch.edits.forEach(edit=>Object.keys(edit.updates).forEach(field=>setBalikanSaveStatus(edit.rowNumber,field,'saving','Menyimpan',batch.sheetName))));try{let successCount=0,failedCount=0;for(const batch of batches){const res=await fetch('/api/balikan-store/bulk-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sheetName:batch.sheetName,edits:batch.edits})});const data=await res.json().catch(()=>({}));if(!res.ok||!data?.success)throw new Error(data?.message||`Gagal update data ${batch.sheetName}`);const failed=new Map((data.failed||[]).map(item=>[`${Number(item.rowNumber)}:${String(item.field||'')}`,item]));batch.edits.forEach(edit=>{Object.entries(edit.updates).forEach(([field,value])=>{const key=getBalikanEditKey(edit.rowNumber,field,batch.sheetName);const fail=failed.get(`${edit.rowNumber}:${field}`);if(fail){failedCount++;setBalikanSaveStatus(edit.rowNumber,field,'error',fail.message||'Gagal update data',batch.sheetName);return;}const latestValue=BALIKAN_STATE.pendingEdits?.[batch.sheetName]?.[edit.rowNumber]?.[field];if(latestValue===value){delete BALIKAN_STATE.pendingEdits[batch.sheetName][edit.rowNumber][field];delete BALIKAN_STATE.pendingEditMeta[key];if(!Object.keys(BALIKAN_STATE.pendingEdits[batch.sheetName][edit.rowNumber]).length)delete BALIKAN_STATE.pendingEdits[batch.sheetName][edit.rowNumber];if(!Object.keys(BALIKAN_STATE.pendingEdits[batch.sheetName]).length)delete BALIKAN_STATE.pendingEdits[batch.sheetName];setBalikanSaveStatus(edit.rowNumber,field,'saved','Tersimpan',batch.sheetName);setTimeout(()=>{const current=getBalikanSaveStatus(edit.rowNumber,field,batch.sheetName);if(current?.status==='saved')setBalikanSaveStatus(edit.rowNumber,field,'','',batch.sheetName);},1200);}updateBalikanLocalRow(edit.rowNumber,field,value,batch.sheetName);successCount++;});});}if(successCount)showToast(`${successCount} perubahan Balikan Store tersimpan`,'success');if(failedCount)toast(`${failedCount} perubahan gagal disimpan. Cek baris bertanda gagal.`,'error');}catch(err){batches.forEach(batch=>batch.edits.forEach(edit=>Object.keys(edit.updates).forEach(field=>setBalikanSaveStatus(edit.rowNumber,field,'error',err?.message||'Gagal update data',batch.sheetName))));toast(err?.message||'Gagal update data','error');}finally{BALIKAN_STATE.saveInProgress=false;if(BALIKAN_STATE.saveRequested)queueBalikanSave(500);}}
async function updateBalikanCell(sheetName,row,field,value,oldValue){const targetSheet=String(sheetName||getBalikanActiveSheetName(row)||'').trim();queueBalikanEdit(targetSheet,row,field,value,oldValue);logActivitySafe({action:'EDIT_BALIKAN_STORE_QUEUE',module:'Balikan Store',detail:`[QUEUE EDIT] ${formatBalikanFieldName(field)}
Sheet: ${targetSheet||'-'}
SKU: ${row?.sku||'-'}
${oldValue||'-'} → ${value||'-'}`,status:'PENDING',metadata:{sheetName:targetSheet,rowNumber:row?.rowNumber,sku:row?.sku||'',field,oldValue,newValue:value}});}
function getBalikanVisibleRows(){const st=ensureBalikanFilterState();const baseRows=(window.BALIKAN_ROWS||[]).map(r=>({...r}));st.rows=baseRows;const rows=sortBalikanRows(applyBalikanTableFilters(baseRows),BALIKAN_STATE.sortBy||'default');st.filtered=rows;const totalPages=Math.max(1,Math.ceil(rows.length/st.pageSize));if(st.page>totalPages)st.page=totalPages;const start=(st.page-1)*st.pageSize;return {st,baseRows,rows,pageRows:rows.slice(start,start+st.pageSize),totalPages,start};}
function scheduleBalikanRender(keepPage=true,delayMs=300){clearTimeout(BALIKAN_STATE.renderTimer);BALIKAN_STATE.renderTimer=setTimeout(()=>renderBalikanTable(keepPage),delayMs);}
function getBalikanColumnClass(field,header=""){const name=String(header||field||"").toLowerCase();if(name==='keterangan')return 'column-keterangan';if(name==='lokasi')return 'column-lokasi';if(name==='raktujuan'||name==='rak tujuan')return 'column-rak-tujuan';if(name==='invent')return 'column-invent';return '';}
function getBalikanEditorOptions(field,header=""){const cellClass=getBalikanColumnClass(field,header);return {cellClass,multiline:!!cellClass};}
function buildBalikanHeaderHtml(baseRows){const st=ensureBalikanFilterState();const filters=st.columnFilters;const headerWithFilter=(col,label)=>{const selected=filters[col]||[];const active=selected.length>0;const options=getBalikanUniqueOptions(baseRows,col);return `<th class='${getBalikanColumnClass(col,label)}'><div class='th-filter-wrap'>${esc(label)}<button class='th-filter-btn ${active?'active':''}' type='button' data-col-filter-toggle data-mode='balikan' data-col='${esc(col)}' title='Filter ${esc(label)}' aria-label='Filter ${esc(label)}'><span class='th-filter-icon'>▾</span>${active?`<span class='th-filter-count'>${selected.length}</span>`:''}</button><div class='th-filter-dropdown' data-col-filter-menu data-mode='balikan' data-col='${esc(col)}' hidden><input class='th-filter-search' data-col-filter-search placeholder='Cari nilai...' aria-label='Cari nilai ${esc(label)}'><div class='th-filter-actions'><button type='button' data-col-filter-clear>Semua</button></div><div class='th-filter-options'>${renderColumnFilterOptions(options,selected)}</div></div></div></th>`;};return `<div class="balikan-table-wrapper"><table class="data-table balikan-table"><thead><tr>${getBalikanTableColumns().map(([key,label])=>headerWithFilter(key,label)).join('')}</tr></thead><tbody></tbody></table></div><div id="balikanPager" class="mv-pagination"></div>`;}
function renderBalikanTable(keepPage=true){if(BALIKAN_STATE.isRendering){BALIKAN_STATE.pendingRender=true;return;}BALIKAN_STATE.isRendering=true;try{const st=ensureBalikanFilterState();if(!keepPage)st.page=1;const {baseRows,rows,pageRows,totalPages}=getBalikanVisibleRows();renderBalikanSummaryInfo(rows,baseRows);if(!baseRows.length){balikanTable.innerHTML='<div class="subtitle">Data kosong.</div>';BALIKAN_STATE.lastRenderedChecksum='';return;}const headerKey=checksumBalikanRows(baseRows,window.BALIKAN_DYNAMIC_COLUMNS||[])+JSON.stringify(st.columnFilters);if(BALIKAN_STATE.lastRenderedHeaderKey!==headerKey||!balikanTable.querySelector('tbody')){balikanTable.innerHTML=buildBalikanHeaderHtml(baseRows);BALIKAN_STATE.lastRenderedHeaderKey=headerKey;BALIKAN_STATE.lastRenderedChecksum='';}renderVisibleBalikanRows(pageRows,totalPages); }finally{BALIKAN_STATE.isRendering=false;if(BALIKAN_STATE.pendingRender){BALIKAN_STATE.pendingRender=false;scheduleBalikanRender(true,0);}}}
function getBalikanDomRowId(rowNumber,sheetName=""){return `balikan-row-${clean(sheetName||'sheet').replace(/[^a-z0-9_-]+/g,'-')}-${Number(rowNumber)}`;}
function createBalikanRow(row){const tr=document.createElement("tr");const rowNumber=Number(row.rowNumber);const sheetName=getBalikanActiveSheetName(row);tr.id=getBalikanDomRowId(rowNumber,sheetName);tr.dataset.rowNumber=String(rowNumber);tr.dataset.sheetName=sheetName;if(BALIKAN_STATE.highlightRowNumber===rowNumber&&(!BALIKAN_STATE.highlightSheetName||BALIKAN_STATE.highlightSheetName===sheetName))tr.classList.add("balikan-row-highlight-static");if(isBalikanLocationRowSelected(row))tr.classList.add("balikan-row-selected-sku");if(BALIKAN_STATE.lastCheckedRowId===rowNumber&&(!BALIKAN_STATE.lastCheckedSheetName||BALIKAN_STATE.lastCheckedSheetName===sheetName)){tr.classList.add("balikan-row-highlight-active");if(BALIKAN_STATE.lastCheckedVersion>0)tr.dataset.highlightVersion=String(BALIKAN_STATE.lastCheckedVersion);}const tdCheck=document.createElement("td");tdCheck.className="col-check";const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.className="balikan-check";checkbox.checked=isCheckedValue(row.checked);checkbox.disabled=!getPermissions().canUpdate;if(getPermissions().canUpdate){checkbox.addEventListener("change",()=>{toggleBalikanCheck(sheetName,row.rowNumber,checkbox.checked);});}tdCheck.appendChild(checkbox);tr.appendChild(tdCheck);const tdSheet=document.createElement("td");tdSheet.innerHTML=`<span class="balikan-sheet-badge">${esc(sheetName||'-')}</span>`;tr.appendChild(tdSheet);const tdNo=document.createElement("td");tdNo.textContent=String(row.no??"");tr.appendChild(tdNo);const tdSku=document.createElement("td");const skuBtn=document.createElement("button");skuBtn.type="button";skuBtn.className="balikan-sku-select";skuBtn.textContent=String(row.sku??"");skuBtn.title="Pilih dan filter SKU ini";skuBtn.addEventListener("click",()=>selectBalikanSkuRow(rowNumber,sheetName));tdSku.appendChild(skuBtn);tr.appendChild(tdSku);const tdNama=document.createElement("td");tdNama.textContent=String(row.namaBarang??"");tr.appendChild(tdNama);const editableFields=['qty','rakTujuan','lokasi','stokBulky','stokRetail','status','keterangan'];editableFields.forEach(field=>{const cell=createEditableCell(row,field,row[field],{...getBalikanEditorOptions(field),getLatestValue:({row,field})=>row?.[field],onInput:({row,field,value})=>{if(field==='status'||field==='keterangan'||isBalikanInventField(field))updateBalikanLocalRow(row.rowNumber,field,value,getBalikanActiveSheetName(row));},onCancel:({row,field,value})=>{if(field==='status'||field==='keterangan'||isBalikanInventField(field))updateBalikanLocalRow(row.rowNumber,field,value,getBalikanActiveSheetName(row));},onSave:async({row,field,value,oldValue})=>{await updateBalikanCell(getBalikanActiveSheetName(row),row,field,value,oldValue);},showSaveButton:false});cell.dataset.field=field;tr.appendChild(cell);});const dynamicCols=Array.isArray(window.BALIKAN_DYNAMIC_COLUMNS)?window.BALIKAN_DYNAMIC_COLUMNS:[];dynamicCols.forEach((col,colIndex)=>{const isInventCol=String(col?.key||'').toLowerCase()==='invent'||String(col?.header||'').toLowerCase()==='invent';const isRightMost=colIndex===dynamicCols.length-1;if(isInventCol||isRightMost){const cell=createEditableCell(row,col.key,row?.[col.key],{...getBalikanEditorOptions(col.key,col.header),getLatestValue:({row})=>row?.[col.key],onInput:({row,field,value})=>{if(isBalikanInventField(field))updateBalikanLocalRow(row.rowNumber,field,value,getBalikanActiveSheetName(row));},onCancel:({row,field,value})=>{if(isBalikanInventField(field))updateBalikanLocalRow(row.rowNumber,field,value,getBalikanActiveSheetName(row));},onSave:async({row,field,value,oldValue})=>{await updateBalikanCell(getBalikanActiveSheetName(row),row,field,value,oldValue);},showSaveButton:false});cell.dataset.field=col.key;tr.appendChild(cell);return;}const td=document.createElement("td");td.textContent=String(row?.[col.key]??"");tr.appendChild(td);});return tr;}
function renderVisibleBalikanRows(givenRows=null,givenTotalPages=null){const calc=givenRows?null:getBalikanVisibleRows();const st=ensureBalikanFilterState();const pageRows=givenRows||(calc?.pageRows||[]);const totalPages=givenTotalPages||calc?.totalPages||1;const tbody=balikanTable?.querySelector('tbody');if(!tbody)return;const checksum=JSON.stringify({selectedSkuRowNumber:BALIKAN_STATE.selectedSkuRowNumber||null,selectedSkuValue:BALIKAN_STATE.selectedSkuValue||'',rows:pageRows.map(r=>[getBalikanActiveSheetName(r),r.rowNumber,r.checked,r.qty,r.rakTujuan,r.lokasi,r.stokBulky,r.stokRetail,r.status,r.keterangan])});if(BALIKAN_STATE.lastRenderedChecksum===checksum){renderBalikanPager(totalPages);return;}const frag=document.createDocumentFragment();pageRows.forEach(row=>frag.appendChild(createBalikanRow(row)));tbody.replaceChildren(frag);BALIKAN_STATE.lastRenderedChecksum=checksum;renderBalikanPager(totalPages);}
function renderBalikanPager(totalPages){const st=ensureBalikanFilterState();const pager=document.getElementById('balikanPager');if(!pager)return;const visibleCount=st.filtered?.length||0;const sheetCount=new Set((st.filtered||[]).map(r=>getBalikanActiveSheetName(r)).filter(Boolean)).size;const from=visibleCount?((st.page-1)*st.pageSize+1):0;const to=visibleCount?Math.min(st.page*st.pageSize,visibleCount):0;pager.innerHTML=`<span>Menampilkan ${from}-${to} dari ${visibleCount.toLocaleString('id-ID')} data${sheetCount?` (${sheetCount} sheet TRIP)`:''}</span><button class='btn-ghost' type='button' data-balikan-page='${Math.max(1,st.page-1)}' ${st.page<=1?'disabled':''}>Prev</button><span>Halaman ${st.page} / ${totalPages}</span><select data-balikan-page-size><option value='25' ${st.pageSize===25?'selected':''}>25 row</option><option value='50' ${st.pageSize===50?'selected':''}>50 row</option><option value='100' ${st.pageSize===100?'selected':''}>100 row</option></select><button class='btn-ghost' type='button' data-balikan-page='${Math.min(totalPages,st.page+1)}' ${st.page>=totalPages?'disabled':''}>Next</button>`;pager.querySelectorAll('[data-balikan-page]').forEach(btn=>btn.addEventListener('click',()=>{st.page=Number(btn.dataset.balikanPage)||1;renderBalikanTable(true);}));pager.querySelector('[data-balikan-page-size]')?.addEventListener('change',e=>{st.pageSize=Number(e.target.value)||50;st.page=1;renderBalikanTable(false);});}
function updateBalikanCellText(rowNumber,field,value,sheetName=""){const cell=document.querySelector(`#${CSS.escape(getBalikanDomRowId(rowNumber,sheetName))} [data-field="${CSS.escape(String(field||''))}"]`);if(cell&&!cell.querySelector('input,select'))cell.childNodes[0]?cell.childNodes[0].textContent=String(value||'-'):cell.textContent=String(value||'-');}
function updateBalikanCellState(rowNumber,field,sheetName=""){const cell=document.querySelector(`#${CSS.escape(getBalikanDomRowId(rowNumber,sheetName))} [data-field="${CSS.escape(String(field||''))}"]`);if(!cell)return;const state=getBalikanSaveStatus(rowNumber,field,sheetName);cell.dataset.saveState=state?.status||'';cell.title=state?.message||'';cell.querySelector('.balikan-save-badge')?.remove();if(state?.status){const badge=document.createElement('span');badge.className=`balikan-save-badge ${state.status==='saved'?'saved':state.status==='error'?'error':''}`;badge.textContent=state.status==='saving'?'menyimpan':state.status==='queued'?'pending':state.status==='saved'?'tersimpan':'gagal';cell.appendChild(badge);}}
function applyBalikanLastCheckedHighlight(rowNumber,sku,sheetName=""){const nextRow=Number(rowNumber)||null;const nextSheet=String(sheetName||'').trim();if(!nextRow)return;const prevRow=BALIKAN_STATE.lastCheckedRowId;const prevSheet=String(BALIKAN_STATE.lastCheckedSheetName||'');const prevEl=prevRow?document.getElementById(getBalikanDomRowId(prevRow,prevSheet)):null;if(prevEl&&(prevRow!==nextRow||prevSheet!==nextSheet)){prevEl.classList.remove("balikan-row-highlight-active");prevEl.classList.add("balikan-row-highlight-fading");const fadeVersion=String(BALIKAN_STATE.lastCheckedVersion+1);prevEl.dataset.highlightVersion=fadeVersion;window.setTimeout(()=>{if(prevEl.dataset.highlightVersion!==fadeVersion)return;prevEl.classList.remove("balikan-row-highlight-fading");},700);}BALIKAN_STATE.lastCheckedVersion=(BALIKAN_STATE.lastCheckedVersion||0)+1;BALIKAN_STATE.lastCheckedRowId=nextRow;BALIKAN_STATE.lastCheckedSheetName=nextSheet;BALIKAN_STATE.lastCheckedSku=String(sku||"");if(BALIKAN_STATE.lastCheckedFadeTimer){clearTimeout(BALIKAN_STATE.lastCheckedFadeTimer);BALIKAN_STATE.lastCheckedFadeTimer=null;}const nextEl=document.getElementById(getBalikanDomRowId(nextRow,nextSheet));if(nextEl){nextEl.classList.remove("balikan-row-highlight-fading");nextEl.classList.add("balikan-row-highlight-active");nextEl.dataset.highlightVersion=String(BALIKAN_STATE.lastCheckedVersion);}BALIKAN_STATE.lastCheckedFadeTimer=window.setTimeout(()=>{const activeEl=document.getElementById(getBalikanDomRowId(BALIKAN_STATE.lastCheckedRowId,BALIKAN_STATE.lastCheckedSheetName));if(!activeEl)return;const version=String(BALIKAN_STATE.lastCheckedVersion);if(activeEl.dataset.highlightVersion!==version)return;activeEl.classList.remove("balikan-row-highlight-active");activeEl.classList.add("balikan-row-highlight-fading");window.setTimeout(()=>{if(activeEl.dataset.highlightVersion!==version)return;activeEl.classList.remove("balikan-row-highlight-fading");},900);},1600);}


async function updateBalikanCheck(sheetName,rowNumber,checked){const targetSheet=String(sheetName||window.currentTripSheet||'').trim();const row=(window.BALIKAN_ROWS||[]).find(r=>Number(r.rowNumber)===Number(rowNumber)&&(!targetSheet||getBalikanActiveSheetName(r)===targetSheet));const oldChecked=isCheckedValue(row?.checked);const activeCheckbox=document.querySelector(`#${CSS.escape(getBalikanDomRowId(rowNumber,targetSheet))} .balikan-check`);updateBalikanLocalRow(rowNumber,'checked',checked?'TRUE':'FALSE',targetSheet);if(activeCheckbox)activeCheckbox.checked=checked===true;try{const res=await fetch('/api/balikan-store/check',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({sheetName:targetSheet,rowNumber,checked})});const data=await res.json();if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal update centang');updateBalikanLocalRow(rowNumber,'checked',checked?'TRUE':'FALSE',targetSheet);if(checked===true)applyBalikanLastCheckedHighlight(Number(rowNumber),row?.sku,targetSheet);toast('Centang berhasil diupdate','success');logActivitySafe({action:'UPDATE_BALIKAN_STORE_CHECK',module:'Balikan Store',detail:`[CHECK]
Sheet: ${targetSheet||'-'}
SKU: ${row?.sku||'-'}
${oldChecked?'FALSE':'TRUE'} → ${checked?'TRUE':'FALSE'}`,status:'SUCCESS',metadata:{sheetName:targetSheet,rowNumber,sku:row?.sku||'',oldValue:oldChecked,newValue:checked,source:'table_check'}});}catch(err){updateBalikanLocalRow(rowNumber,'checked',oldChecked?'TRUE':'FALSE',targetSheet);if(activeCheckbox)activeCheckbox.checked=oldChecked;throw err;}}
window.toggleBalikanCheck=async(sheetName,rowNumber,checked)=>{try{await updateBalikanCheck(sheetName,Number(rowNumber),checked===true);}catch(err){toast(err?.message||'Gagal update centang','error');renderBalikanTable();throw err;}};

function openBalikanScanner(){openBarcodeScanner("balikanSearchInput",handleBalikanScanResult);}
window.openBalikanScanner=openBalikanScanner;

async function handleBalikanScanResult(decodedText){if(navigator.vibrate)navigator.vibrate(100);let result;try{result=await resolveScannedSku(decodedText);}catch(err){console.error("Barcode lookup failed",err);toast("Gagal mencari barcode. Silakan coba lagi.","error");return;}const {scanned,sku,mapped}=result;if(!scanned){toast("Barcode tidak ditemukan","error");return;}window.balikanSearchKeyword=sku;BALIKAN_STATE.exactScanSku=sku;const searchInput=document.querySelector("#balikanSearchInput");if(searchInput)searchInput.value=sku;saveBalikanSearchHistory(sku);const row=(window.BALIKAN_ROWS||[]).find(item=>String(item.sku||"").trim().toLowerCase()===String(sku||"").trim().toLowerCase());if(!mapped){BALIKAN_STATE.highlightRowNumber=null;toast("Barcode tidak ditemukan","error");renderBalikanTable(false);return;}if(!row){BALIKAN_STATE.highlightRowNumber=null;toast("SKU tidak ditemukan di Balikan Store: "+sku,"error");renderBalikanTable(false);return;}BALIKAN_STATE.highlightRowNumber=Number(row.rowNumber);BALIKAN_STATE.highlightSheetName=getBalikanActiveSheetName(row);renderBalikanTable(false);if(BALIKAN_STATE.autoCheckOnScan!==false){await toggleBalikanCheck(getBalikanActiveSheetName(row),Number(row.rowNumber),true);showToast('SKU berhasil discan dan dicentang: '+sku,'success');}else{showToast('SKU berhasil discan: '+sku,'success');}setTimeout(()=>{const el=document.getElementById(getBalikanDomRowId(row.rowNumber,getBalikanActiveSheetName(row)));if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.classList.add("row-highlight");}},300);}

function bindSheetInputForm(){
const form=document.getElementById("sheetInputForm");
if(!form||form.dataset.bound==="1")return;
const submitBtn=document.getElementById("sheetSubmitBtn");
const labelEl=submitBtn?.querySelector(".sheet-submit-label");
const spinnerEl=submitBtn?.querySelector(".btn-spinner");
const setLoading=(loading)=>{if(!submitBtn)return;submitBtn.disabled=loading;submitBtn.classList.toggle("is-loading",loading);if(labelEl)labelEl.textContent=loading?"Menyimpan":"Simpan";if(spinnerEl)spinnerEl.hidden=!loading;};
form.addEventListener("submit",async(e)=>{e.preventDefault();const tanggal=document.getElementById("sheetTanggal")?.value||"";const sku=(document.getElementById("sheetSku")?.value||"").trim();const nama_barang=(document.getElementById("sheetNamaBarang")?.value||"").trim();const qtyRaw=(document.getElementById("sheetQty")?.value||"").trim();const lokasi=(document.getElementById("sheetLokasi")?.value||"").trim();const keterangan=(document.getElementById("sheetKeterangan")?.value||"").trim();const qty=Number(qtyRaw);if(!sku||!nama_barang||!lokasi||Number.isNaN(qty)){toast("SKU, Nama Barang, Qty, dan Lokasi wajib diisi.","error");return;}setLoading(true);try{const res=await fetch('/api/sheet-input',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tanggal,sku,nama_barang,qty,lokasi,keterangan})});const json=await res.json();if(!res.ok||!json?.success)throw new Error(json?.error||'Gagal menyimpan data');toast(json?.message||"Data berhasil disimpan.","success");form.reset();}catch(err){toast(err?.message||"Terjadi kesalahan saat menyimpan.","error");}finally{setLoading(false);}});
form.dataset.bound="1";
}


function getBarangRejectCache(){if(barangRejectCache)return barangRejectCache;barangRejectCache=safeJsonParse(localStorage.getItem(BARANG_REJECT_CACHE_KEY),null,false)||null;return barangRejectCache;}
function setBarangRejectCache(payload){barangRejectCache={...payload,lastSync:Number(payload?.lastSync)||Date.now()};try{localStorage.setItem(BARANG_REJECT_CACHE_KEY,JSON.stringify(barangRejectCache));}catch(err){console.warn('Gagal simpan cache Barang Reject',err);}}
function isBarangRejectCacheFresh(cache=getBarangRejectCache()){const ts=Number(cache?.lastSync)||0;return !!cache&&(Date.now()-ts)<barangRejectCacheTTL;}
function isBarangRejectQuotaError(message){return /quota|read requests per minute|rate limit/i.test(String(message||''));}
function showBarangRejectQuotaToastOnce(){if(barangRejectQuotaToastShown)return;barangRejectQuotaToastShown=true;toast('Google Sheets quota limit. Coba lagi beberapa menit.','error');setTimeout(()=>{barangRejectQuotaToastShown=false;},barangRejectCacheTTL);}
function applyBarangRejectData(payload,{fromCache=false}={}){BARANG_REJECT_STATE.stock=Array.isArray(payload?.stock)?payload.stock:[];BARANG_REJECT_STATE.masuk=Array.isArray(payload?.masuk)?payload.masuk:[];BARANG_REJECT_STATE.keluar=Array.isArray(payload?.keluar)?payload.keluar:[];BARANG_REJECT_STATE.lastSync=Number(payload?.lastSync)||Date.now();BARANG_REJECT_STATE.error="";if(!fromCache)setBarangRejectCache({stock:BARANG_REJECT_STATE.stock,masuk:BARANG_REJECT_STATE.masuk,keluar:BARANG_REJECT_STATE.keluar,lastSync:BARANG_REJECT_STATE.lastSync});}
async function loadBarangRejectData({force=false,background=false}={}){const cached=getBarangRejectCache();if(!force&&isBarangRejectCacheFresh(cached)){applyBarangRejectData(cached,{fromCache:true});return cached;}if(isBarangRejectLoading)return cached||barangRejectCache;isBarangRejectLoading=true;lastBarangRejectFetchAt=Date.now();BARANG_REJECT_STATE.refreshing=true;if(!background)BARANG_REJECT_STATE.loading=true;renderBarangRejectPage();try{const res=await fetch(`/api/barang-reject${force?'?force=1':''}`,{cache:'no-store'});const data=await res.json().catch(() => ({}));if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal memuat Barang Reject');applyBarangRejectData(data);logActivitySafe({action:'REFRESH_BARANG_REJECT',module:'Barang Reject',detail:'Refresh data Barang Reject',status:'SUCCESS'});return data;}catch(err){const msg=err?.message||'Gagal memuat Barang Reject';if(cached){applyBarangRejectData(cached,{fromCache:true});BARANG_REJECT_STATE.error=isBarangRejectQuotaError(msg)?'Menampilkan cache terakhir karena Google Sheets quota limit.':msg;}else{BARANG_REJECT_STATE.error=msg;}if(isBarangRejectQuotaError(msg))showBarangRejectQuotaToastOnce();else if(!background)toast(msg,'error');logActivitySafe({action:'REFRESH_BARANG_REJECT',module:'Barang Reject',detail:BARANG_REJECT_STATE.error,status:'FAILED'});return cached||null;}finally{BARANG_REJECT_STATE.loading=false;BARANG_REJECT_STATE.refreshing=false;isBarangRejectLoading=false;renderBarangRejectPage();}}
async function fetchBarangRejectData(options={}){return loadBarangRejectData(options);}
function ensureBarangRejectLoaded(){const cache=getBarangRejectCache();if(cache&&(!BARANG_REJECT_STATE.stock.length&&!BARANG_REJECT_STATE.masuk.length&&!BARANG_REJECT_STATE.keluar.length))applyBarangRejectData(cache,{fromCache:true});if(!isBarangRejectCacheFresh(cache)&&!isBarangRejectLoading&&!BARANG_REJECT_STATE.refreshing)queueMicrotask(()=>loadBarangRejectData({background:!!cache}));}
function rejectTokensMatch(row,query){const q=normalizeSearch(query);if(!q)return true;const hay=normalizeSearch([row.sku,row.namaBarang,row.lokasi,row.from,row.to,row.pic,row.status,row.statusBarang,row.statusProses,row.keterangan,row.noIseller,row.netsuite,row.keteranganLainnya,row.lokasiSuratJalan,row.stckoutReject].join(' '));const skuText=normalizeSearch(row.sku);return skuText.includes(q)||q.split(/\s+/).filter(Boolean).every(tok=>hay.includes(tok));}
function rejectMonthKey(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return 'Tanpa tanggal';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function thisMonthRows(rows){const now=new Date();return rows.filter(r=>{const d=new Date(r.tanggal);return !Number.isNaN(d.getTime())&&d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();});}
function sumQty(rows){return rows.reduce((a,r)=>a+(Number(r.qty)||0),0);}
function topBy(rows,key){const m=new Map();rows.forEach(r=>{const v=String(r[key]||'-').trim()||'-';m.set(v,(m.get(v)||0)+(Number(r.qty)||1));});return [...m.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'-';}
function rejectQtyTone(v){return Number(v)>=0?'b-in':'b-out';}
function renderRejectCards(){const stock=BARANG_REJECT_STATE.stock.filter(r=>(Number(r.qty)||0)>0);const skuSet=new Set(stock.map(r=>String(r.sku||'').trim()).filter(Boolean));const locSet=new Set(stock.map(r=>String(r.lokasi||'').trim()).filter(Boolean));const masukMonth=sumQty(thisMonthRows(BARANG_REJECT_STATE.masuk));const keluarMonth=sumQty(thisMonthRows(BARANG_REJECT_STATE.keluar));const cards=[['Total SKU Reject',skuSet.size,'package-x'],['Total Qty Reject',sumQty(stock),'boxes'],['Barang Masuk Bulan Ini',masukMonth,'package-plus'],['Barang Keluar Bulan Ini',keluarMonth,'package-minus'],['Lokasi Reject Aktif',locSet.size,'map-pin'],['Selisih Masuk vs Keluar',masukMonth-keluarMonth,'activity']];return `<div class="grid dashboard reject-dashboard-cards">${cards.map(([k,v,icon])=>`<div class="metric card"><div class="metric-head"><span class="k">${esc(k)}</span><i data-lucide="${icon}"></i></div><div class="v">${esc(v)}</div></div>`).join('')}</div>`;}
function topRejectEntries(rows,key,limit=5){const m=new Map();(rows||[]).forEach(r=>{const label=String(r?.[key]||'-').trim()||'-';m.set(label,(m.get(label)||0)+(Number(r?.qty)||0));});return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit);}
function orderRejectSheetRows(rows){return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>(Number(b?.rowNumber)||0)-(Number(a?.rowNumber)||0));}
function rejectInsightIcon(label){if(/keluar|berkurang|minus/i.test(label))return 'alert-triangle';if(/sku|stok|pcs/i.test(label))return 'package';return 'sparkles';}
function renderRejectMiniList(title,items,{empty='Belum ada data'}={}){return `<article class="card reject-insight-card reject-modern-card reject-auto-insight"><div class="reject-card-title"><i data-lucide="sparkles"></i><h4>${esc(title)}</h4></div><div class="reject-insight-list reject-insight-list--modern">${items.length?items.slice(0,5).map(item=>`<div class="reject-insight-row reject-insight-row--modern"><span class="reject-insight-icon"><i data-lucide="${rejectInsightIcon(item[0])}"></i></span><span>${esc(item[0])}</span>${item[1]!==''?`<strong class="badge b-warn">${esc(item[1])}</strong>`:''}</div>`).join(''):`<div class="state">${esc(empty)}</div>`}</div></article>`;}
function renderRejectDashboardDetails(){const stock=BARANG_REJECT_STATE.stock.filter(r=>(Number(r.qty)||0)>0);const skuSet=new Set(stock.map(r=>String(r.sku||'').trim()).filter(Boolean));const totalStock=sumQty(stock);const locSet=new Set(stock.map(r=>String(r.lokasi||'').trim()).filter(Boolean));const masukMonth=sumQty(thisMonthRows(BARANG_REJECT_STATE.masuk));const keluarMonth=sumQty(thisMonthRows(BARANG_REJECT_STATE.keluar));const delta=Math.abs(masukMonth-keluarMonth);const insights=[];if(keluarMonth>masukMonth)insights.push([`🚨 Barang keluar reject lebih tinggi ${delta.toLocaleString('id-ID')} pcs. Stok reject bulan ini berkurang.`, '']);else if(masukMonth>keluarMonth)insights.push([`📈 Barang masuk reject lebih tinggi ${delta.toLocaleString('id-ID')} pcs. Stok reject bulan ini bertambah.`, '']);else insights.push(['✅ Masuk dan keluar reject bulan ini seimbang.', '']);insights.push([`📦 ${skuSet.size.toLocaleString('id-ID')} SKU reject aktif. Total stok reject saat ini ${totalStock.toLocaleString('id-ID')} pcs.`, '']);insights.push([`📍 ${locSet.size.toLocaleString('id-ID')} lokasi reject aktif terpantau.`, '']);return `<div class="reject-insight-grid reject-insight-grid--compact">${renderRejectMiniList('Auto Insight Reject',insights,{empty:'Belum ada insight'})}</div>`;}
function renderRejectChart(rows,label,cls){const grouped=new Map();rows.forEach(r=>grouped.set(rejectMonthKey(r.tanggal),(grouped.get(rejectMonthKey(r.tanggal))||0)+(Number(r.qty)||0)));const data=[...grouped.entries()].sort().slice(-12);const max=Math.max(1,...data.map(([,v])=>v));return `<article class="card reject-chart"><h4>${esc(label)}</h4><div class="reject-bars">${(data.length?data:[['-',0]]).map(([m,v])=>`<div class="reject-bar-item"><div class="reject-bar ${cls}" style="height:${Math.max(6,(v/max)*140)}px" title="${esc(m)}: ${v}"></div><small>${esc(m)}</small><strong>${v}</strong></div>`).join('')}</div></article>`;}
function renderRejectDashboard(){return `${renderRejectCards()}<div class="reject-dashboard-lower">${renderRejectDashboardDetails()}<article class="card reject-chart reject-chart--combined"><h4>Grafik sederhana Masuk vs Keluar per bulan</h4><div class="reject-chart-grid reject-chart-grid--inner">${renderRejectChart(BARANG_REJECT_STATE.masuk,'Masuk','in')}${renderRejectChart(BARANG_REJECT_STATE.keluar,'Keluar','out')}</div></article></div>`;}
function sortRejectRows(rows,kind){const {key,dir}=BARANG_REJECT_STATE.sort;const factor=dir==='asc'?1:-1;return [...rows].sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''),'id')*factor);}
function dateInRange(value,from,to){const raw=String(value||'').slice(0,10);if(from&&raw<from)return false;if(to&&raw>to)return false;return true;}
function paginateReject(rows,kind){const page=Math.max(1,Number(BARANG_REJECT_STATE.page[kind])||1),size=BARANG_REJECT_STATE.pageSize;return rows.slice((page-1)*size,page*size);}
function rejectPager(kind,total){const page=Math.max(1,Number(BARANG_REJECT_STATE.page[kind])||1),totalPage=Math.max(1,Math.ceil(total/BARANG_REJECT_STATE.pageSize));return `<div class="mv-pagination reject-pager"><span>Page ${page}/${totalPage} • ${total.toLocaleString('id-ID')} row</span><div class="row"><button class="btn-ghost" data-reject-page="${kind}" data-dir="prev" ${page<=1?'disabled':''}>Prev</button><button class="btn-ghost" data-reject-page="${kind}" data-dir="next" ${page>=totalPage?'disabled':''}>Next</button></div></div>`;}
function thRejectStatic(label){return `<th>${esc(label)}</th>`;}
function rejectActionButtons(kind,r){if(!canCrud())return '';return `<td class="reject-actions" data-label="Aksi"><button class="icon-btn" data-reject-edit="${kind}" data-row="${Number(r.rowNumber)||''}" title="Edit inline"><i data-lucide="pencil"></i></button></td>`;}
function rejectStatusBadge(status){const s=String(status||'-');const tone=/done|selesai|complete|approved|keluar/i.test(s)?'b-in':/pending|proses|hold/i.test(s)?'b-warn':'b-out';return `<span class="badge ${tone}">${esc(s)}</span>`;}
const REJECT_IN_COLUMNS=[['Tanggal','tanggal','date'],['From','from'],['To','to'],['SKU','sku'],['Nama Barang','namaBarang'],['Qty','qty','number'],['Status','statusBarang','select'],['PIC','pic'],['Keterangan','keterangan'],['No iSeller','noIseller'],['Netsuite','netsuite'],['Keterangan Lainnya','keteranganLainnya'],['Lokasi Surat Jalan','lokasiSuratJalan'],['STCKOUT Reject','stckoutReject']];
const REJECT_OUT_COLUMNS=[['Tanggal','tanggal','date'],['From','from'],['To','to'],['SKU','sku'],['Nama Barang','namaBarang'],['Qty','qty','number'],['Status Barang','statusBarang','select'],['PIC','pic'],['Keterangan','keterangan'],['No iSeller','noIseller'],['Netsuite','netsuite'],['Keterangan Lainnya','keteranganLainnya'],['Status Proses','statusProses','select'],['Lokasi Surat Jalan','lokasiSuratJalan']];
function rejectColumnFilters(kind){BARANG_REJECT_STATE.columnFilters=BARANG_REJECT_STATE.columnFilters||{masuk:{},keluar:{}};BARANG_REJECT_STATE.columnFilters[kind]=BARANG_REJECT_STATE.columnFilters[kind]||{};return BARANG_REJECT_STATE.columnFilters[kind];}
function rejectColumnFilterValue(kind,key){return rejectColumnFilters(kind)[key]||'';}
function rejectColumnOptions(rows,key){return [...new Set((rows||[]).map(r=>String(r[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id')).slice(0,30);}
function renderRejectHeaderFilter(kind,col,rows){const [label,key,type]=col;const value=rejectColumnFilterValue(kind,key);if(type==='select'){const opts=rejectColumnOptions(rows,key);return `<div class="reject-th-filter"><select data-reject-col-filter="${kind}" data-col="${key}" aria-label="Filter ${esc(label)}"><option value="">Semua</option>${opts.map(o=>`<option value="${esc(o)}" ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select>${value?`<button type="button" data-reject-clear-col="${kind}" data-col="${key}" aria-label="Clear ${esc(label)}">×</button>`:''}</div>`;}return `<div class="reject-th-filter"><input type="${type==='date'?'date':'search'}" data-reject-col-filter="${kind}" data-col="${key}" placeholder="filter ${esc(label.toLowerCase())}" value="${esc(value)}" aria-label="Filter ${esc(label)}">${value?`<button type="button" data-reject-clear-col="${kind}" data-col="${key}" aria-label="Clear ${esc(label)}">×</button>`:''}</div>`;}
function thRejectFilter(label,kind,col,rows){return `<th><div class="reject-th-label">${esc(label)}</div>${renderRejectHeaderFilter(kind,col,rows)}</th>`;}
function rejectColumnMatch(row,kind,cols){const filters=rejectColumnFilters(kind);return cols.every(([,key,type])=>{const q=String(filters[key]||'').trim();if(!q)return true;const val=String(row[key]??'').trim();if(type==='date')return val.slice(0,10)===q;return clean(val).includes(clean(q));});}
function renderRejectCell(r,col){const [label,key,type]=col;const val=key==='qty'?Number(r[key])||0:r[key];if(type==='select')return rejectStatusBadge(val);if(key==='qty')return `<strong>${val}</strong>`;return esc(val);}
function renderRejectTableRows(rows,cols,kind){return rows.map(r=>`<tr>${cols.map(col=>`<td data-label="${esc(col[0])}">${renderRejectCell(r,col)}</td>`).join('')}${rejectActionButtons(kind,r)||'<td data-label="Aksi">-</td>'}</tr>`).join('');}
function renderRejectToolbar(kind,{title,subtitle,searchKey}){const f=BARANG_REJECT_STATE.filters;return `<div class="reject-page-title-row"><div><h3>${esc(title)}</h3><small class="subtitle">${esc(subtitle)}</small></div><div class="row reject-title-actions"><button class="btn-primary" data-reject-open-form="${kind}" ${!canCrud()?'hidden':''}><i data-lucide="plus"></i>Tambah Data</button><button class="btn-ghost" data-reject-export="${kind}">Export</button></div></div><div class="movement-toolbar reject-movement-toolbar"><input class="search-lg" data-reject-filter="${searchKey}" placeholder="Cari SKU, nama barang, lokasi asal/tujuan" value="${esc(f[searchKey])}"></div>`;}
function renderRejectIn(){const f=BARANG_REJECT_STATE.filters;let rows=BARANG_REJECT_STATE.masuk.filter(r=>rejectTokensMatch(r,f.masukSearch));rows=orderRejectSheetRows(rows);const pageRows=paginateReject(rows,'masuk');return `${renderRejectToolbar('masuk',{title:'Barang Masuk Reject',subtitle:'Filter mengikuti halaman Barang Masuk di menu Data: search utama sederhana.',searchKey:'masukSearch'})}<div class="card reject-card"><div class="table-wrap reject-table-wrap"><table><thead><tr>${REJECT_IN_COLUMNS.map(c=>thRejectStatic(c[0])).join('')}${thRejectStatic('Aksi')}</tr></thead><tbody>${pageRows.length?renderRejectTableRows(pageRows,REJECT_IN_COLUMNS,'masuk'):`<tr><td colspan="15"><div class="state">Belum ada barang masuk reject.</div></td></tr>`}</tbody></table></div>${rejectPager('masuk',rows.length)}</div>`;}
function renderRejectOut(){const f=BARANG_REJECT_STATE.filters;let rows=BARANG_REJECT_STATE.keluar.filter(r=>rejectTokensMatch(r,f.keluarSearch));rows=orderRejectSheetRows(rows);const pageRows=paginateReject(rows,'keluar');return `${renderRejectToolbar('keluar',{title:'Barang Keluar Reject',subtitle:'Filter mengikuti halaman Barang Keluar di menu Data: search utama sederhana.',searchKey:'keluarSearch'})}<div class="card reject-card"><div class="table-wrap reject-table-wrap"><table><thead><tr>${REJECT_OUT_COLUMNS.map(c=>thRejectStatic(c[0])).join('')}${thRejectStatic('Aksi')}</tr></thead><tbody>${pageRows.length?renderRejectTableRows(pageRows,REJECT_OUT_COLUMNS,'keluar'):`<tr><td colspan="15"><div class="state">Belum ada barang keluar reject.</div></td></tr>`}</tbody></table></div>${rejectPager('keluar',rows.length)}</div>`;}

function todayIso(){return new Date().toISOString().slice(0,10);}
function rejectFormField(label,name,{type='text',required=false,textarea=false}={}){return `<label class="reject-field"><span>${esc(label)}${required?' *':''}</span>${textarea?`<textarea name="${esc(name)}" rows="3" ${required?'required':''}></textarea>`:`<input type="${type}" name="${esc(name)}" ${required?'required':''}>`}</label>`;}
function renderRejectForm(kind){const isIn=kind==='masuk';const cols=isIn?REJECT_IN_COLUMNS:REJECT_OUT_COLUMNS;const title=isIn?'Barang Masuk Reject':'Barang Keluar Reject';const fields=cols.map(([,key,type])=>{if(key==='tanggal')return rejectFormField('Tanggal','tanggal',{type:'date',required:true});if(key==='sku')return rejectFormField('SKU','sku',{required:true});if(key==='qty')return rejectFormField('Qty','qty',{type:'number',required:true});if(key==='from')return rejectFormField('From','from',{required:true});if(key==='namaBarang')return rejectFormField('Nama Barang','namaBarang');if(key==='statusBarang')return rejectFormField('Status Barang','statusBarang');if(key==='statusProses')return rejectFormField('Status Proses','statusProses');if(key==='keterangan'||key==='keteranganLainnya')return rejectFormField(key==='keterangan'?'Keterangan':'Keterangan Lainnya',key,{textarea:true});return rejectFormField(cols.find(c=>c[1]===key)?.[0]||key,key);}).join('');return `<div class="reject-modal-backdrop" data-reject-close-form><aside class="reject-drawer" role="dialog" aria-modal="true" aria-label="Form ${title}" onclick="event.stopPropagation()"><div class="reject-drawer-head"><div><h3>${title}</h3><small>Form mengikuti kolom sheet ${title}.</small></div><button class="icon-btn" data-reject-close-form><i data-lucide="x"></i></button></div><form id="${isIn?'rejectInForm':'rejectOutForm'}" class="reject-form" data-crud-form><div class="reject-form-grid">${fields}</div><div class="reject-form-actions"><button class="btn-primary" type="submit">Simpan</button><button class="btn-ghost" type="button" data-reject-close-form>Batal</button></div></form></aside></div>`;}
function renderBarangRejectPage(){const root=document.getElementById('barangRejectApp');if(!root)return;document.querySelectorAll('.side-link[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===getBarangRejectNavPage()));document.getElementById('rejectPermissionBadge')?.toggleAttribute('hidden',canCrud());syncActiveSidebarParent('barang-reject');ensureBarangRejectLoaded();const body=BARANG_REJECT_STATE.loading&&!BARANG_REJECT_STATE.stock.length?`<div class="card reject-skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>`:BARANG_REJECT_STATE.activeTab==='dashboard'?renderRejectDashboard():BARANG_REJECT_STATE.activeTab==='masuk'?renderRejectIn():BARANG_REJECT_STATE.activeTab==='keluar'?renderRejectOut():renderRejectDashboard();root.innerHTML=`<div class="reject-meta"><span class="subtitle">Sheet: KARTU STOCK KST • Barang Masuk • Barang Keluar</span><span class="subtitle">Last sync: ${BARANG_REJECT_STATE.lastSync?formatDateTime(BARANG_REJECT_STATE.lastSync):'-'}</span>${BARANG_REJECT_STATE.error?`<span class="state error">${esc(BARANG_REJECT_STATE.error)}</span>`:''}</div>${body}`;bindBarangRejectEvents();if(window.lucide)lucide.createIcons();}
function bindBarangRejectEvents(){const refreshBtn=document.getElementById('rejectRefreshBtn');if(refreshBtn){refreshBtn.disabled=isBarangRejectLoading||BARANG_REJECT_STATE.refreshing;refreshBtn.classList.toggle('is-loading',refreshBtn.disabled);refreshBtn.addEventListener('click',()=>loadBarangRejectData({force:true}));}document.querySelectorAll('[data-reject-filter]').forEach(input=>input.oninput=()=>{BARANG_REJECT_STATE.filters[input.dataset.rejectFilter]=input.value;BARANG_REJECT_STATE.page.stock=BARANG_REJECT_STATE.page.masuk=BARANG_REJECT_STATE.page.keluar=1;renderBarangRejectPage();});document.querySelectorAll('[data-reject-page]').forEach(btn=>btn.onclick=()=>{const k=btn.dataset.rejectPage;BARANG_REJECT_STATE.page[k]=Math.max(1,(BARANG_REJECT_STATE.page[k]||1)+(btn.dataset.dir==='next'?1:-1));renderBarangRejectPage();});document.querySelectorAll('[data-reject-export]').forEach(btn=>btn.onclick=()=>exportBarangRejectCsv(btn.dataset.rejectExport));document.querySelectorAll('[data-reject-open-form]').forEach(btn=>btn.onclick=()=>{if(!guardCrudAction('CREATE','/barang-reject'))return;document.body.insertAdjacentHTML('beforeend',renderRejectForm(btn.dataset.rejectOpenForm));bindRejectSubmitForms();const dateInput=document.querySelector('.reject-modal-backdrop input[name="tanggal"]');if(dateInput&&!dateInput.value)dateInput.value=todayIso();if(window.lucide)lucide.createIcons();});document.querySelectorAll('[data-reject-edit]').forEach(btn=>btn.onclick=()=>toast('Inline edit mengikuti permission CRUD. Penyimpanan edit akan aktif saat endpoint update tersedia.','info'));}

function rejectFormPayload(form){return Object.fromEntries(new FormData(form).entries());}
async function submitRejectForm(kind,form){const isIn=kind==='masuk';const stateKey=isIn?'submittingIn':'submittingOut';if(BARANG_REJECT_STATE[stateKey])return;const payload=rejectFormPayload(form);payload.qty=Number(payload.qty);payload.action=kind;payload.user=currentUserIdentity().user_name||currentUserIdentity().user_id||'';if(!payload.tanggal||!payload.sku||!(payload.qty>0)||!payload.from){toast('Tanggal, SKU, Qty > 0, dan From wajib diisi.','error');return;}BARANG_REJECT_STATE[stateKey]=true;try{const res=await fetch('/api/barang-reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await res.json();if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal submit Barang Reject');toast(data.message||'Data berhasil disimpan','success');document.querySelector('.reject-modal-backdrop')?.remove();await loadBarangRejectData({force:true,background:true});BARANG_REJECT_STATE.activeTab=kind;history.replaceState({},'',`/barang-reject/${kind}`);}catch(err){toast(err?.message||'Gagal submit Barang Reject','error');}finally{BARANG_REJECT_STATE[stateKey]=false;renderBarangRejectPage();}}
function bindRejectSubmitForms(){document.querySelectorAll('[data-reject-close-form]').forEach(el=>el.onclick=()=>document.querySelector('.reject-modal-backdrop')?.remove());document.getElementById('rejectInForm')?.addEventListener('submit',e=>{e.preventDefault();submitRejectForm('masuk',e.currentTarget);});document.getElementById('rejectOutForm')?.addEventListener('submit',e=>{e.preventDefault();submitRejectForm('keluar',e.currentTarget);});}
function exportBarangRejectCsv(kind){const cols=kind==='keluar'?REJECT_OUT_COLUMNS:REJECT_IN_COLUMNS;const rows=kind==='keluar'?BARANG_REJECT_STATE.keluar:BARANG_REJECT_STATE.masuk;const lines=[cols.map(c=>c[0]).join(','),...rows.map(r=>cols.map(c=>`"${String(r[c[1]]??'').replaceAll('"','""')}"`).join(','))];const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`barang-reject-${kind}.csv`;a.click();URL.revokeObjectURL(a.href);toast('Export CSV Barang Reject berhasil','success');}

async function logActivitySafe(payload){try{await logActivity({...currentUserIdentity(),...payload});}catch(_){}}
async function withActivity(payload,fn){return logActivityResult({...currentUserIdentity(),...payload},fn);}
async function getActivityLogAccessHeaders(){const devRaw=localStorage.getItem("dev_auth_session");if(devRaw){try{const dev=JSON.parse(devRaw);if(dev?.session?.access_token)return {Authorization:`Bearer ${dev.session.access_token}`};}catch(_err){}}if(isPreviewBypassLoginEnabled())return {"X-Preview-Bypass-Login":"true"};const {data}=await supabase.auth.getSession();return data?.session?.access_token?{Authorization:`Bearer ${data.session.access_token}`}:{ };}

function getPdfJsLib(){
if(window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
if(window.__pdfjsLibPromise)return window.__pdfjsLibPromise;
window.__pdfjsLibPromise=new Promise((resolve,reject)=>{
const script=document.createElement("script");
script.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs";
script.type="module";
script.onload=()=>{};
script.onerror=()=>reject(new Error("Gagal memuat pdf.js"));
const modScript=document.createElement("script");
modScript.type="module";
modScript.textContent='import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs"; pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs"; window.pdfjsLib = pdfjsLib;';
document.head.appendChild(modScript);
setTimeout(()=>window.pdfjsLib?resolve(window.pdfjsLib):reject(new Error("pdf.js belum siap")),500);
});
return window.__pdfjsLibPromise;
}
function isSkuCandidate(text){return /^[A-Za-z0-9][A-Za-z0-9\-\/.]{2,}$/.test(String(text||"").trim());}
function getNamaProdukBySkuFromKartuStock(sku){
const skuKey=clean(String(sku||""));
if(!skuKey)return "";
const kartuRows=Array.isArray(DATA?.["Kartu Stock"])?DATA["Kartu Stock"]:[];
const hit=kartuRows.find(row=>clean(String(getVal(row,["sku","kode sku","item code","kode barang"])||""))===skuKey);
return String(getVal(hit,["nama barang","nama","item","description","item name"])||"").trim();
}
function buildKartuStockSkuMap(){
const map=new Map();
const kartuRows=Array.isArray(DATA?.["Kartu Stock"])?DATA["Kartu Stock"]:[];
for(const row of kartuRows){
const rawSku=String(getVal(row,["sku","kode sku","item code","kode barang"])||"").trim();
if(!rawSku)continue;
const normalized=clean(rawSku);
if(!normalized)continue;
if(!map.has(normalized)){
map.set(normalized,{sku:rawSku,nama:String(getVal(row,["nama barang","nama","item","description","item name"])||"").trim()});
}
}
return map;
}
function normalizeSkuKey(value){
return clean(String(value||"")).replace(/[^a-z0-9]/g,"");
}
function cleanupTransferHeaderValue(value){
let text=String(value||"").trim();
text=text.replace(/\bTanggal\s+Dibuat\b.*$/i,"").trim();
text=text.replace(/\bPerkiraan\s+Tanggal\s+Sampai\b.*$/i,"").trim();
return text.replace(/\s{2,}/g," ").trim();
}
function csvEscape(value){
const text=String(value??"");
return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
function rowsToCsv(rows){return (rows||[]).map(row=>(row||[]).map(csvEscape).join(',')).join('\n');}
function parseCsvText(text){
const rows=[];let row=[];let cell="";let quoted=false;
const input=String(text||"");
for(let i=0;i<input.length;i++){
const ch=input[i];
if(quoted){
if(ch==='"'&&input[i+1]==='"'){cell+='"';i++;}
else if(ch==='"'){quoted=false;}
else cell+=ch;
}else{
if(ch==='"')quoted=true;
else if(ch===','){row.push(cell);cell="";}
else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell="";}
else if(ch==='\r'){}
else cell+=ch;
}
}
row.push(cell);rows.push(row);
return rows.filter(r=>r.some(c=>String(c||"").trim()));
}
function normalizeTransferCsvHeader(value){return clean(String(value||"")).replace(/[^a-z0-9]+/g,' ').trim();}
function isTransferCsvNumber(value){return /^-?\d+(?:[.,]\d+)?$/.test(String(value??'').trim().replace(/\./g,'').replace(',', '.'));}
function splitCollapsedTransferCsvLine(line){
const text=String(line||'').replace(/\s+/g,' ').trim();
if(!text||/^(sku|nama\s+produk|jumlah|diterima|batal|tolak|catatan)\b/i.test(text))return null;
const tokens=text.split(' ').filter(Boolean);
const skuIndex=tokens.findIndex(tok=>isSkuCandidate(tok));
if(skuIndex<0)return null;
const sku=tokens[skuIndex];
const tail=tokens.slice(skuIndex+1);
const numericIndexes=[];
for(let i=0;i<tail.length;i++)if(isTransferCsvNumber(tail[i]))numericIndexes.push(i);
if(!numericIndexes.length)return [sku,tail.join(' '),'','','','',''];
let qtyIndex=numericIndexes[0];
if(numericIndexes.length>=4){
const consecutiveStart=numericIndexes.find((idx,pos)=>numericIndexes[pos+1]===idx+1&&numericIndexes[pos+2]===idx+2&&numericIndexes[pos+3]===idx+3);
if(consecutiveStart!==undefined)qtyIndex=consecutiveStart;
}
const namaProduk=tail.slice(0,qtyIndex).join(' ').trim();
const qty=tail[qtyIndex]||'';
const diterima=tail[qtyIndex+1]||'';
const batal=tail[qtyIndex+2]||'';
const tolak=tail[qtyIndex+3]||'';
const catatan=tail.slice(qtyIndex+4).join(' ').trim();
return [sku,namaProduk,qty,diterima,batal,tolak,catatan];
}
function repairTransferCsvRow(row){
const cells=(row||[]).map(c=>String(c||'').trim());
const nonEmpty=cells.filter(Boolean);
if(nonEmpty.length!==1)return null;
return splitCollapsedTransferCsvLine(nonEmpty[0]);
}
function isTransferNoteText(value){return /\b(RUSAK|MATI|PATAH|TIDAK|NYALA|KOTOR|MACET|PECAH|HILANG|SOBEK|RETAK)\b/i.test(String(value||''));}
function splitQtyAndNoteFromText(value){
const text=String(value||'').replace(/\s+/g,' ').trim();
const match=text.match(/^(.*?)(\d+)\s+((?:RUSAK|MATI|PATAH|TIDAK|NYALA|KOTOR|MACET|PECAH|HILANG|SOBEK|RETAK)\b.*)$/i);
if(!match)return null;
return {prefix:match[1].trim(),qty:match[2],note:match[3].trim()};
}
function appendTransferText(base,value){const text=String(value||'').replace(/\s+/g,' ').trim();return text?`${String(base||'').trim()} ${text}`.trim():String(base||'').trim();}
function cleanTransferFooterText(value){return String(value||'').replace(/\b(?:Disiapkan|Dikirimkan|Diterima)\s+Oleh\b.*$/i,'').replace(/\s+/g,' ').trim();}
function isTransferFooterText(value){return /\b(?:Disiapkan|Dikirimkan|Diterima)\s+Oleh\b/i.test(String(value||''));}
function isTransferHeaderLikeLine(line){return /\b(SKU|Nama\s+Produk|Nama\s+Barang|Jumlah|Qty|Diterima|Batal|Tolak|Catatan)\b/i.test(String(line||''));}
function hasTransferQtyValue(split){return split&&String(split[2]||'').trim()&&isTransferCsvNumber(split[2]);}
function findTransferTextTableStart(textRows){
const rows=textRows||[];
for(let i=0;i<Math.min(rows.length,90);i++){
const combined=rows.slice(i,i+4).join(' ');
if(/\bSKU\b/i.test(combined)&&/(Nama\s+Produk|Nama\s+Barang|Produk|Description)/i.test(combined)&&/(Jumlah|Qty|Diterima|Batal|Tolak)/i.test(combined))return i;
}
const firstData=rows.findIndex(row=>hasTransferQtyValue(splitCollapsedTransferCsvLine(row)));
return firstData>0?firstData-1:firstData;
}
function textRowsToTransferCsvRows(textRows){
const startIdx=findTransferTextTableStart(textRows);
if(startIdx<0)return [];
const csvRows=[['SKU','Nama Produk','Jumlah','Diterima','Batal','Tolak','Catatan']];
let foundData=false;
for(let i=startIdx+1;i<textRows.length;i++){
const line=String(textRows[i]||'').replace(/\s+/g,' ').trim();
if(!line)continue;
if(foundData&&/^(grand\s+total|total|status\s+transfer|nomor\s+referensi|perkiraan\s+tanggal)\b/i.test(line))break;
const split=splitCollapsedTransferCsvLine(line);
if(split&&hasTransferQtyValue(split)){csvRows.push(split);foundData=true;continue;}
if(!foundData&&isTransferHeaderLikeLine(line))continue;
if(foundData&&split){csvRows.push(split);continue;}
if(foundData)csvRows.push([line,'','','','','','']);
}
return csvRows.length>1?csvRows:[];
}
function mapTransferCsvDataRow(row,map){
let cells=row||[];
let rowMap=map;
const isStructured=Array.isArray(cells)&&cells.length>1;
const rowText=cells.map(c=>String(c||'').trim()).filter(Boolean).join(' ');
const repaired=!isStructured?repairTransferCsvRow(cells):null;
if(repaired){cells=repaired;rowMap={sku:0,namaProduk:1,qty:2,diterima:3,batal:4,tolak:5,catatan:6};}
let sku=String(cells[rowMap.sku]||'').trim();
let namaProduk=String(rowMap.namaProduk!==undefined?cells[rowMap.namaProduk]||'':'').trim();
let qtyRaw=String(rowMap.qty!==undefined?cells[rowMap.qty]||'':'').trim().replace(/\./g,'').replace(',', '.');
let diterima=String(rowMap.diterima!==undefined?cells[rowMap.diterima]||'':'').trim();
let batal=String(rowMap.batal!==undefined?cells[rowMap.batal]||'':'').trim();
let tolak=String(rowMap.tolak!==undefined?cells[rowMap.tolak]||'':'').trim();
let catatan=String(rowMap.catatan!==undefined?cells[rowMap.catatan]||'':'').trim();
if(!isStructured&&!repaired&&(!sku||!qtyRaw||Number.isNaN(Number(qtyRaw)))){
const split=splitCollapsedTransferCsvLine(rowText);
if(split){
cells=split;sku=split[0];namaProduk=split[1];qtyRaw=String(split[2]||'').replace(/\./g,'').replace(',', '.');diterima=split[3];batal=split[4];tolak=split[5];catatan=split[6];
}
}
const catatanQty=splitQtyAndNoteFromText(catatan);
if(catatanQty&&(!qtyRaw||Number.isNaN(Number(qtyRaw))||Number(qtyRaw)>99)){
namaProduk=appendTransferText(namaProduk,catatanQty.prefix);
qtyRaw=catatanQty.qty;
catatan=catatanQty.note;
}
const mid=[{field:'qty',value:qtyRaw},{field:'diterima',value:diterima},{field:'batal',value:batal},{field:'tolak',value:tolak}];
if(!qtyRaw||Number.isNaN(Number(qtyRaw))){
let qtyIdx=-1;
for(let i=mid.length-1;i>=0;i--){if(isTransferCsvNumber(mid[i].value)){qtyIdx=i;break;}}
if(qtyIdx>=0){
qtyRaw=String(mid[qtyIdx].value).replace(/\./g,'').replace(',', '.');
for(let i=0;i<mid.length;i++){
if(i===qtyIdx)continue;
const value=mid[i].value;
if(!value)continue;
if(i<qtyIdx)namaProduk=appendTransferText(namaProduk,value);
else if(isTransferNoteText(value))catatan=appendTransferText(catatan,value);
else namaProduk=appendTransferText(namaProduk,value);
}
diterima='';batal='';tolak='';
}
}else{
for(const part of [diterima,batal,tolak]){
if(!part)continue;
if(isTransferNoteText(part))catatan=appendTransferText(catatan,part);
else namaProduk=appendTransferText(namaProduk,part);
}
diterima='';batal='';tolak='';
}
namaProduk=cleanTransferFooterText(namaProduk);
catatan=cleanTransferFooterText(catatan);
const qty=Number(qtyRaw);
const reasons=[];
if(!sku)reasons.push('SKU kosong');
if(!qtyRaw||Number.isNaN(qty))reasons.push('Jumlah/Qty bukan angka');
return {item:{sku,namaProduk,qty,diterima,batal,tolak,catatan},row:cells,reason:reasons.join(', ')};
}
function detectTransferCsvColumnMap(headers){
const aliases={
sku:['sku','kode sku','kode barang','item code'],
namaProduk:['nama produk','nama barang','produk','nama','item','description','item name'],
qty:['jumlah','qty','quantity','kuantitas'],
diterima:['diterima','received'],
batal:['batal','cancel','cancelled'],
tolak:['tolak','ditolak','reject','rejected'],
catatan:['catatan','note','notes','keterangan']
};
const normalized=(headers||[]).map(normalizeTransferCsvHeader);
const map={};
const detected=[];
for(const [field,names] of Object.entries(aliases)){
const idx=normalized.findIndex(h=>names.some(name=>h===name||h.includes(name)));
if(idx>=0){map[field]=idx;detected.push(`${headers[idx]||`Kolom ${idx+1}`} → ${field}`);}
}
return {map,detected,normalized};
}
function findTransferCsvHeaderIndex(rows){
let best={idx:-1,score:0,map:{},detected:[]};
(rows||[]).slice(0,40).forEach((row,idx)=>{
const hit=detectTransferCsvColumnMap(row||[]);
const score=(hit.map.sku!==undefined?3:0)+(hit.map.qty!==undefined?3:0)+(hit.map.namaProduk!==undefined?2:0)+Object.keys(hit.map).length;
if(score>best.score)best={idx,score,map:hit.map,detected:hit.detected};
});
return best.score>=4?best:{idx:-1,score:0,map:{},detected:[]};
}
function parseTransferCsvRows(csvRows){
const headerHit=findTransferCsvHeaderIndex(csvRows);
const warnings=[];
const failedRows=[];
if(headerHit.idx<0){
warnings.push('Format tabel PDF tidak cocok. Periksa file atau edit preview sebelum import.');
return {headerIndex:-1,headers:[],items:[],warnings,failedRows,detectedColumns:[]};
}
const headers=csvRows[headerHit.idx]||[];
const {map,detected}=detectTransferCsvColumnMap(headers);
if(map.sku===undefined)warnings.push('Kolom SKU tidak terdeteksi.');
if(map.qty===undefined)warnings.push('Kolom Jumlah/Qty tidak terdeteksi.');
[['namaProduk','Nama Produk'],['diterima','Diterima'],['batal','Batal'],['tolak','Tolak'],['catatan','Catatan']].forEach(([field,label])=>{if(map[field]===undefined)warnings.push(`Kolom ${label} tidak terdeteksi; nilai akan kosong.`);});
const items=[];
for(let r=headerHit.idx+1;r<csvRows.length;r++){
let row=csvRows[r]||[];
const rowText=row.map(c=>String(c||'').trim()).filter(Boolean).join(' ');
if(!rowText)continue;
if(/^(grand\s+total|total|status\s+transfer|nomor\s+referensi)\b/i.test(rowText))break;
const mapped=mapTransferCsvDataRow(row,map);
if(mapped.reason){failedRows.push({rowNumber:r+1,row:mapped.row,reason:mapped.reason});continue;}
items.push(mapped.item);
}
if(!items.length)warnings.push('Tidak ada row valid dari CSV. Import diblokir sampai minimal ada satu row valid.');
return {headerIndex:headerHit.idx,headers,items,warnings,failedRows,detectedColumns:detected};
}
function getPdfItemX(item){return Number(item?.transform?.[4]||0);}
function getPdfItemY(item){return Number(item?.transform?.[5]||0);}
function groupPdfItemsByRows(items){
const sorted=(items||[]).filter(it=>String(it?.str||'').trim()).sort((a,b)=>getPdfItemY(b)-getPdfItemY(a)||getPdfItemX(a)-getPdfItemX(b));
const rows=[];
for(const item of sorted){
const y=getPdfItemY(item);
let row=rows.find(r=>Math.abs(r.y-y)<=3);
if(!row){row={y,items:[]};rows.push(row);}
row.items.push(item);
}
rows.forEach(r=>r.items.sort((a,b)=>getPdfItemX(a)-getPdfItemX(b)));
return rows;
}
function findPdfHeaderAnchor(flat,field){
const byRaw=pattern=>flat.find(entry=>pattern.test(entry.raw));
const byNorm=pattern=>flat.find(entry=>pattern.test(entry.norm));
if(field==='no')return byRaw(/^#$/)||byNorm(/^(no|nomor)$/);
if(field==='namaProduk')return byNorm(/produk|nama\s+produk|nama\s+barang|description/);
if(field==='sku')return byNorm(/kode\s+barang|sku|kode\s+sku|item\s+code/);
if(field==='qty')return byNorm(/^(jumlah|qty|quantity|kuantitas)$/)||byNorm(/jumlah|qty|quantity|kuantitas/);
if(field==='diterima')return byNorm(/diterima|received/);
if(field==='batal')return byNorm(/batal|cancel/);
if(field==='tolak')return byNorm(/tolak|reject/);
if(field==='catatan')return byNorm(/catatan|note|keterangan/);
return null;
}
function detectPdfTableColumns(pdfRows){
const fields=['no','namaProduk','sku','qty','diterima','batal','tolak','catatan'];
const labels={no:'#',namaProduk:'Nama Produk',sku:'SKU',qty:'Jumlah',diterima:'Diterima',batal:'Batal',tolak:'Tolak',catatan:'Catatan'};
for(let ri=0;ri<Math.min(pdfRows.length,120);ri++){
const windowRows=pdfRows.slice(ri,ri+5);
const combined=normalizeTransferCsvHeader(windowRows.map(row=>row.items.map(it=>it.str).join(' ')).join(' '));
const hasProduct=/produk|nama\s+produk|nama\s+barang|description/.test(combined);
const hasSku=/sku|kode\s+barang|kode\s+sku|item\s+code/.test(combined);
const hasQty=/jumlah|qty|quantity|kuantitas/.test(combined);
if(!(hasProduct&&hasSku&&hasQty))continue;
const flat=[];
windowRows.forEach((row,offset)=>row.items.forEach(it=>flat.push({it,rowIndex:ri+offset,raw:String(it.str||'').trim(),norm:normalizeTransferCsvHeader(it.str),x:getPdfItemX(it)})));
const anchors=[];
for(const field of fields){
const found=findPdfHeaderAnchor(flat,field);
if(found)anchors.push({field,label:labels[field],x:found.x,rowIndex:found.rowIndex});
}
if(anchors.some(a=>a.field==='namaProduk')&&anchors.some(a=>a.field==='sku')&&anchors.some(a=>a.field==='qty')){
anchors.sort((a,b)=>a.x-b.x);
return {headerRowIndex:Math.max(...anchors.map(a=>a.rowIndex)),columns:anchors};
}
}
return {headerRowIndex:-1,columns:[]};
}
function appendPdfCell(target,field,value){
const text=String(value||'').replace(/\s+/g,' ').trim();
if(!text)return;
target[field]=target[field]?`${target[field]} ${text}`:text;
}
function pdfRowsToCsvRows(pdfRows){
const detected=detectPdfTableColumns(pdfRows);
if(detected.headerRowIndex<0)return [];
const columns=detected.columns;
const boundaries=columns.map((col,idx)=>idx===0?-Infinity:(columns[idx-1].x+col.x)/2).concat([Infinity]);
const outputFields=['sku','namaProduk','qty','diterima','batal','tolak','catatan'];
const outputHeaders=['SKU','Nama Produk','Jumlah','Diterima','Batal','Tolak','Catatan'];
const getRowCells=(row)=>{
const rowCells={};
for(const item of row.items){
const text=String(item.str||'').trim();
if(!text)continue;
const x=getPdfItemX(item);
let ci=0;
for(let b=0;b<columns.length;b++){if(x>=boundaries[b]&&x<boundaries[b+1]){ci=b;break;}}
const field=columns[ci]?.field;
if(field)appendPdfCell(rowCells,field,text);
}
return rowCells;
};
const isIgnoredRow=(rowText)=>/^(transfer\s*#|dari\b|kepada\b|nomor\s+referensi|tanggal\s+dibuat|perkiraan\s+tanggal|status\s+transfer)/i.test(rowText)||isTransferFooterText(rowText)||isTransferHeaderLikeLine(rowText)&&/(kode\s+barang|sku|jumlah|qty)/i.test(rowText);
const isSummaryQtyOnlyRow=(rowCells)=>isTransferCsvNumber(rowCells.qty)&&!String(rowCells.no||'').trim()&&!String(rowCells.sku||'').trim()&&!String(rowCells.namaProduk||'').trim()&&!String(rowCells.diterima||'').trim()&&!String(rowCells.batal||'').trim()&&!String(rowCells.tolak||'').trim()&&!String(rowCells.catatan||'').trim();
const skuRowIndexes=[];
for(let ri=detected.headerRowIndex+1;ri<pdfRows.length;ri++){
const row=pdfRows[ri];
const rowText=row.items.map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
if(!rowText||isIgnoredRow(rowText))continue;
if(/^(grand\s+total|total)\b/i.test(rowText))break;
const rowCells=getRowCells(row);
const sku=String(rowCells.sku||'').trim();
if(sku&&isSkuCandidate(sku))skuRowIndexes.push(ri);
}
const records=[];
for(let si=0;si<skuRowIndexes.length;si++){
const start=skuRowIndexes[si];
const end=skuRowIndexes[si+1]||pdfRows.length;
const record={};
for(let ri=start;ri<end;ri++){
const row=pdfRows[ri];
const rowText=row.items.map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
if(!rowText||isIgnoredRow(rowText))continue;
if(ri>start&&/^(grand\s+total|total)\b/i.test(rowText))break;
const rowCells=getRowCells(row);
if(ri>start&&isSummaryQtyOnlyRow(rowCells))break;
if(ri===start){
appendPdfCell(record,'sku',rowCells.sku);
appendPdfCell(record,'namaProduk',rowCells.namaProduk);
if(isTransferCsvNumber(rowCells.qty))appendPdfCell(record,'qty',rowCells.qty);else appendPdfCell(record,'namaProduk',rowCells.qty);
appendPdfCell(record,'diterima',rowCells.diterima);
appendPdfCell(record,'batal',rowCells.batal);
appendPdfCell(record,'tolak',rowCells.tolak);
appendPdfCell(record,'catatan',rowCells.catatan);
continue;
}
appendPdfCell(record,'namaProduk',rowCells.namaProduk);
if(rowCells.qty){
if(!record.qty&&isTransferCsvNumber(rowCells.qty))appendPdfCell(record,'qty',rowCells.qty);
else appendPdfCell(record,'namaProduk',rowCells.qty);
}
for(const field of ['diterima','batal','tolak']){
const value=String(rowCells[field]||'').trim();
if(!value)continue;
if(isTransferCsvNumber(value)&&!String(record[field]||'').trim())appendPdfCell(record,field,value);
else appendPdfCell(record,'namaProduk',value);
}
appendPdfCell(record,'catatan',rowCells.catatan);
}
if(outputFields.some(field=>String(record[field]||'').trim()))records.push(record);
}
const csvRows=[outputHeaders];
for(const record of records){
const row=outputFields.map(field=>String(record[field]||'').trim());
if(row.some(Boolean))csvRows.push(row);
}
return csvRows.length>1?csvRows:[];
}
function formatPdfTransferFileSize(size){
const n=Number(size)||0;
if(!n)return "-";
if(n<1024*1024)return `${Math.max(1,Math.round(n/1024))} KB`;
return `${(n/(1024*1024)).toFixed(2)} MB`;
}
function setPdfTransferSelectedFile(file){
if(!file)return;
if(!/\.pdf$/i.test(file.name||"")&&file.type!=="application/pdf"){toast('File harus PDF','error');return;}
PDF_TRANSFER_STATE.selectedFile=file;
PDF_TRANSFER_STATE.lastFileName=file.name||'';
PDF_TRANSFER_STATE.warnings=[];
renderImportPdfTransferPage();
}
async function loadImportPdfConfiguration(){
if(PDF_TRANSFER_STATE.configLoaded)return;
try{const res=await fetch('/api/import-pdf-transfer');const out=await res.json();PDF_TRANSFER_STATE.configAvailable=!!(res.ok&&out?.success&&out?.configured);PDF_TRANSFER_STATE.configError=PDF_TRANSFER_STATE.configAvailable?'':(out?.message||'Spreadsheet Import PDF belum dikonfigurasi.');}catch(err){PDF_TRANSFER_STATE.configAvailable=false;PDF_TRANSFER_STATE.configError=err?.message||'Spreadsheet Import PDF belum dikonfigurasi.';}finally{PDF_TRANSFER_STATE.configLoaded=true;renderImportPdfTransferPage();}
}
function validatePdfTransferNumber(value){const name=String(value||'').trim();if(!name)return {valid:false,message:'Nomor Transfer belum tersedia.'};if(name.length>100)return {valid:false,message:'Nomor Transfer maksimal 100 karakter untuk nama sheet.'};if(/[\\/:?*\[\]]/.test(name))return {valid:false,message:'Nomor Transfer mengandung karakter yang tidak diizinkan Google Sheets: \\ / : ? * [ ]'};return {valid:true,name};}
function renderImportPdfTransferPage(){
const root=document.getElementById("importPdfTransferApp");if(!root)return;
if(!PDF_TRANSFER_STATE.configLoaded)queueMicrotask(loadImportPdfConfiguration);
const items=PDF_TRANSFER_STATE.items||[],totalQty=items.reduce((n,r)=>n+(Number(r.qty)||0),0),file=PDF_TRANSFER_STATE.selectedFile,fileName=file?.name||PDF_TRANSFER_STATE.lastFileName||'',fileMeta=file?`${formatPdfTransferFileSize(file.size)} • PDF`:fileName?'Siap diproses':'Belum ada file';
const transferCheck=validatePdfTransferNumber(PDF_TRANSFER_STATE.header?.nomorTransfer),transferNumber=transferCheck.valid?transferCheck.name:'';
const statusText=PDF_TRANSFER_STATE.isParsing?'Membaca PDF dan menyiapkan preview...':PDF_TRANSFER_STATE.isImporting?'Membuat sheet baru dan mengimport data...':items.length?'Preview siap diedit sebelum import':'Upload PDF transfer untuk mulai parsing.';
const canImport=!PDF_TRANSFER_STATE.isImporting&&items.length>0&&transferCheck.valid&&PDF_TRANSFER_STATE.configAvailable;
const result=PDF_TRANSFER_STATE.importResult;
root.innerHTML=`<div class='pdf-import-shell'><section class='pdf-upload-card'><div class='pdf-upload-head'><div><h4>Upload Dokumen Transfer</h4><p>Upload file PDF transfer, sistem akan membaca tabel dan menyiapkan preview yang bisa diedit sebelum import.</p></div><span class='pdf-status-pill ${items.length?'ready':PDF_TRANSFER_STATE.isParsing?'loading':''}'>${PDF_TRANSFER_STATE.isParsing?'Parsing':items.length?'Preview siap':'Menunggu PDF'}</span></div><div class='pdf-upload-grid'><label class='pdf-dropzone' id='pdfTransferDropzone' for='pdfTransferFile'><input id='pdfTransferFile' type='file' accept='application/pdf' hidden/><span class='pdf-drop-icon'>PDF</span><strong>${fileName?esc(fileName):'Pilih atau drag PDF Transfer'}</strong><small>${esc(fileMeta)}</small><em>Klik area ini untuk memilih file PDF</em></label><div class='pdf-upload-side'><div class='pdf-flow-steps'><span class='active'>1 Upload</span><span class='${items.length?'active':''}'>2 Preview</span><span class='${result?'active':''}'>3 Import</span></div><div class='pdf-action-grid'><button id='pdfTransferParseBtn' class='btn-primary' ${PDF_TRANSFER_STATE.isParsing||!fileName?'disabled':''}>${PDF_TRANSFER_STATE.isParsing?'Memproses...':'Parse PDF'}</button><button id='pdfTransferImportBtn' class='btn-primary' ${!canImport?'disabled':''}>${PDF_TRANSFER_STATE.isImporting?'Importing...':'Import Data'}</button><button id='pdfTransferResetBtn' class='btn-ghost'>Reset</button></div><p class='pdf-helper-text'>${esc(statusText)}</p></div></div></section>${result?`<section class='card pdf-section-card'><div class='state'><strong>Import berhasil.</strong><p>Sheet: ${esc(result.sheetName)} · SKU: ${result.importedRows} · Total Qty: ${result.totalQty}</p><div class='row'>${result.sheetUrl?`<a class='btn-primary' href='${esc(result.sheetUrl)}' target='_blank' rel='noopener'>Lihat Sheet</a>`:''}<button id='pdfTransferNewBtn' class='btn-ghost'>Import PDF Baru</button></div></div></section>`:''}<section class='pdf-summary-grid'><div class='pdf-summary-card'><span>Total SKU</span><strong>${items.length}</strong></div><div class='pdf-summary-card'><span>Total Qty</span><strong>${totalQty}</strong></div><div class='pdf-summary-card'><span>File</span><strong>${fileName?esc(fileName):'-'}</strong></div>${transferNumber?`<div class='pdf-summary-card'><span>Sheet Baru</span><strong>${esc(transferNumber)}</strong></div>`:''}</section><section class='card pdf-section-card'><div class='pdf-section-title'><div><h4>Header Transfer</h4><p>Nomor Transfer menentukan nama sheet baru dan dapat diperbaiki sebelum import.</p></div></div><div class='grid dashboard pdf-header-grid'>${[['Nomor Transfer','nomorTransfer'],['Dari','dari'],['Kepada','kepada'],['Nomor Referensi','nomorReferensi']].map(([label,key])=>`<label>${label}<input data-pdf-header='${key}' class='search-lg' value='${esc(PDF_TRANSFER_STATE.header?.[key]||'')}'/>${key==='nomorTransfer'?`<small>${transferCheck.valid?`Sheet akan dibuat sebagai: ${esc(transferCheck.name)} — dibuat otomatis saat import`:esc(transferCheck.message)}</small>`:''}</label>`).join('')}</div>${PDF_TRANSFER_STATE.configError?`<div class='state pdf-warning'>${esc(PDF_TRANSFER_STATE.configError)}</div>`:''}</section>${PDF_TRANSFER_STATE.duplicate?`<section class='card pdf-section-card'><div class='state pdf-warning'><strong>Sheet ${esc(PDF_TRANSFER_STATE.duplicate.sheetName)} sudah tersedia.</strong><p>Transfer ${esc(PDF_TRANSFER_STATE.duplicate.sheetName)} sudah pernah dibuat. Data existing tidak diubah.</p><div class='row'><button id='pdfDuplicateCancel' class='btn-ghost'>Batalkan</button>${PDF_TRANSFER_STATE.duplicate.sheetUrl?`<a class='btn-primary' href='${esc(PDF_TRANSFER_STATE.duplicate.sheetUrl)}' target='_blank' rel='noopener'>Buka Sheet Existing</a>`:''}</div></div></section>`:''}<section class='card pdf-section-card'><div class='pdf-section-title'><div><h4>Preview Item</h4><p>Double click sel untuk mengedit data sebelum import.</p></div><span>${items.length} SKU • Qty ${totalQty}</span></div><div class='table-wrap pdf-preview-table'><table><thead><tr><th>SKU</th><th>Nama Produk</th><th>Jumlah</th><th>Diterima</th><th>Batal</th><th>Tolak</th><th>Catatan</th></tr></thead><tbody>${items.map((it,idx)=>`<tr>${['sku','namaProduk','qty','diterima','batal','tolak','catatan'].map(k=>`<td contenteditable='true' data-pdf-item='${idx}' data-field='${k}'>${esc(String(it[k]??''))}</td>`).join('')}</tr>`).join('')||"<tr><td colspan='7'><div class='state'>Belum ada item. Upload dan parse PDF terlebih dahulu.</div></td></tr>"}</tbody></table></div>${PDF_TRANSFER_STATE.warnings.length?`<div class='state pdf-warning'>Warning: ${PDF_TRANSFER_STATE.warnings.map(esc).join(' | ')}</div>`:''}</section></div>`;
document.getElementById('pdfTransferFile')?.addEventListener('change',e=>setPdfTransferSelectedFile(e.target.files?.[0]));const dropzone=document.getElementById('pdfTransferDropzone');dropzone?.addEventListener('dragover',e=>{e.preventDefault();dropzone.classList.add('dragover');});dropzone?.addEventListener('dragleave',()=>dropzone.classList.remove('dragover'));dropzone?.addEventListener('drop',e=>{e.preventDefault();dropzone.classList.remove('dragover');setPdfTransferSelectedFile(e.dataTransfer?.files?.[0]);});document.getElementById('pdfTransferParseBtn')?.addEventListener('click',parsePdfTransferFile);document.getElementById('pdfTransferImportBtn')?.addEventListener('click',importPdfTransferData);document.getElementById('pdfDuplicateCancel')?.addEventListener('click',()=>{PDF_TRANSFER_STATE.duplicate=null;renderImportPdfTransferPage();});const reset=()=>{Object.assign(PDF_TRANSFER_STATE,{header:{},items:[],warnings:[],debugRows:[],rawText:'',csvText:'',csvRows:[],detectedColumns:[],failedRows:[],logs:[],isParsing:false,isImporting:false,importResult:null,duplicate:null,lastFileName:'',selectedFile:null});renderImportPdfTransferPage();};document.getElementById('pdfTransferResetBtn')?.addEventListener('click',reset);document.getElementById('pdfTransferNewBtn')?.addEventListener('click',reset);root.querySelectorAll('[data-pdf-header]').forEach(el=>el.addEventListener('input',e=>{PDF_TRANSFER_STATE.header[e.target.dataset.pdfHeader]=e.target.value;PDF_TRANSFER_STATE.importResult=null;PDF_TRANSFER_STATE.duplicate=null;if(e.target.dataset.pdfHeader==='nomorTransfer')renderImportPdfTransferPage();}));root.querySelectorAll('[data-pdf-item]').forEach(el=>el.addEventListener('input',e=>{const idx=Number(e.target.dataset.pdfItem),key=e.target.dataset.field;PDF_TRANSFER_STATE.items[idx][key]=e.target.textContent;}));
}
async function parsePdfTransferFile(){
const file=PDF_TRANSFER_STATE.selectedFile||document.getElementById('pdfTransferFile')?.files?.[0];if(!file)return toast('Pilih file PDF dulu','error');
PDF_TRANSFER_STATE.selectedFile=file;PDF_TRANSFER_STATE.isParsing=true;PDF_TRANSFER_STATE.logs=[];PDF_TRANSFER_STATE.warnings=[];PDF_TRANSFER_STATE.items=[];PDF_TRANSFER_STATE.failedRows=[];PDF_TRANSFER_STATE.detectedColumns=[];PDF_TRANSFER_STATE.csvRows=[];PDF_TRANSFER_STATE.csvText='';PDF_TRANSFER_STATE.debugRows=[];PDF_TRANSFER_STATE.lastFileName=file.name||'';renderImportPdfTransferPage();
try{
const pdfjs=await getPdfJsLib();const buf=await file.arrayBuffer();const pdf=await pdfjs.getDocument({data:buf}).promise;const allItems=[];const textRows=[];const pdfRows=[];PDF_TRANSFER_STATE.logs.push(`PDF page count: ${pdf.numPages}`);
for(let p=1;p<=pdf.numPages;p++){
const page=await pdf.getPage(p);const tc=await page.getTextContent();allItems.push(...tc.items);
const pageRows=groupPdfItemsByRows(tc.items);
pdfRows.push(...pageRows);
pageRows.forEach(row=>{const rowText=row.items.map(x=>x.str).join(' ').replace(/\s+/g,' ').trim();if(rowText)textRows.push(rowText);});
}
PDF_TRANSFER_STATE.logs.push(`Total text items PDF: ${allItems.length}`);
PDF_TRANSFER_STATE.debugRows=textRows.slice(0,80);
let csvRows=pdfRowsToCsvRows(pdfRows);
if(!csvRows.length){
csvRows=textRowsToTransferCsvRows(textRows);
if(csvRows.length)PDF_TRANSFER_STATE.logs.push('Fallback CSV dari baris tabel PDF dipakai karena struktur kolom PDF tidak terdeteksi.');
else PDF_TRANSFER_STATE.logs.push(`CSV fallback belum menemukan tabel. Sample PDF rows: ${textRows.slice(0,12).join(' || ')||'-'}`);
}
PDF_TRANSFER_STATE.csvRows=csvRows;
PDF_TRANSFER_STATE.csvText=rowsToCsv(csvRows);
PDF_TRANSFER_STATE.rawText=PDF_TRANSFER_STATE.csvText;
PDF_TRANSFER_STATE.logs.push(`Total row CSV: ${csvRows.length}`);
const header={};const findVal=(label)=>{const rx=new RegExp(`(?:${label})\\s*[:\\-]?\\s*(.+)$`,'i');const hit=textRows.find(r=>rx.test(r));return hit?(hit.match(rx)?.[1]||'').trim():''};
const topRows=textRows.slice(0,12);const transferTop=topRows.find(r=>/transfer(?:\s+number)?\s*[:#-]?\s*#?t-\d+/i.test(r))||"";
header.nomorTransfer=(transferTop.match(/(#?T-\d+)/i)?.[1]||findVal('Nomor Transfer|No Transfer').match(/#?T-\d+/i)?.[0]||'').trim();
header.dari=cleanupTransferHeaderValue(findVal('Dari'));
header.kepada=cleanupTransferHeaderValue(findVal('Kepada'));
header.nomorReferensi=findVal('Nomor Referensi|No Referensi|Reference');
let parsed=parseTransferCsvRows(parseCsvText(PDF_TRANSFER_STATE.csvText));
if(!parsed.items.length){
const fallbackCsvRows=textRowsToTransferCsvRows(textRows);
if(fallbackCsvRows.length&&rowsToCsv(fallbackCsvRows)!==PDF_TRANSFER_STATE.csvText){
PDF_TRANSFER_STATE.logs.push('Fallback CSV repair dipakai karena CSV awal tidak menghasilkan row valid.');
csvRows=fallbackCsvRows;
PDF_TRANSFER_STATE.csvRows=csvRows;
PDF_TRANSFER_STATE.csvText=rowsToCsv(csvRows);
PDF_TRANSFER_STATE.rawText=PDF_TRANSFER_STATE.csvText;
parsed=parseTransferCsvRows(parseCsvText(PDF_TRANSFER_STATE.csvText));
}
}
PDF_TRANSFER_STATE.header=header;
PDF_TRANSFER_STATE.items=parsed.items;
PDF_TRANSFER_STATE.warnings=parsed.warnings;
PDF_TRANSFER_STATE.failedRows=parsed.failedRows;
PDF_TRANSFER_STATE.detectedColumns=parsed.detectedColumns;
PDF_TRANSFER_STATE.logs.push(`Kolom yang terdeteksi: ${parsed.detectedColumns.join(' | ')||'-'}`);
PDF_TRANSFER_STATE.logs.push(`Parsed row valid: ${parsed.items.length}`);
PDF_TRANSFER_STATE.logs.push(`Row gagal mapping + alasan: ${parsed.failedRows.length}`);
if(!parsed.items.length)PDF_TRANSFER_STATE.logs.push(`Sample PDF rows untuk debug: ${textRows.slice(0,20).join(' || ')||'-'}`);
if(parsed.items.length)toast('CSV berhasil dibaca dan preview siap diedit','success');
else toast('CSV terbaca, tapi belum ada row valid','error');
}catch(err){PDF_TRANSFER_STATE.logs.push(`ERROR: ${err.message||err}`);toast('Gagal convert PDF ke CSV','error');}
finally{PDF_TRANSFER_STATE.isParsing=false;renderImportPdfTransferPage();}
}
function getValidatedPdfTransferRowsForImport(){
const failed=[];
const valid=[];
(PDF_TRANSFER_STATE.items||[]).forEach((row,idx)=>{
const sku=String(row.sku||'').trim();
const qty=Number(String(row.qty??'').trim().replace(/\./g,'').replace(',', '.'));
const reasons=[];
if(!sku)reasons.push('SKU kosong');
if(String(row.qty??'').trim()===''||Number.isNaN(qty))reasons.push('Jumlah/Qty bukan angka');
if(reasons.length)failed.push({rowNumber:idx+1,row:Object.values(row),reason:reasons.join(', ')});
else valid.push({...row,sku,qty});
});
return {valid,failed};
}
async function importPdfTransferData(){if(PDF_TRANSFER_STATE.isImporting)return;const transferCheck=validatePdfTransferNumber(PDF_TRANSFER_STATE.header?.nomorTransfer);if(!transferCheck.valid){toast(transferCheck.message,'error');return;}const {valid,failed}=getValidatedPdfTransferRowsForImport();if(failed.length){PDF_TRANSFER_STATE.failedRows=failed;PDF_TRANSFER_STATE.warnings=[`Masih ada ${failed.length} row preview gagal validasi. Perbaiki sebelum import.`];renderImportPdfTransferPage();toast('Perbaiki row yang gagal validasi sebelum import','error');return;}if(!valid.length){toast('Tidak ada row CSV valid untuk import','error');return;}if(!PDF_TRANSFER_STATE.configAvailable){toast('Spreadsheet Import PDF belum dikonfigurasi.','error');return;}PDF_TRANSFER_STATE.isImporting=true;PDF_TRANSFER_STATE.duplicate=null;renderImportPdfTransferPage();
try{const header=PDF_TRANSFER_STATE.header;const res=await fetch('/api/import-pdf-transfer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transferNumber:transferCheck.name,header:{from:header.dari||'',to:header.kepada||'',referenceNumber:header.nomorReferensi||''},rows:valid})});const out=await res.json();if(res.status===409&&out?.code==='TRANSFER_ALREADY_EXISTS'){PDF_TRANSFER_STATE.duplicate=out;toast(out.message,'error');return;}if(!res.ok||!out?.success)throw new Error(out?.message||'Gagal import');PDF_TRANSFER_STATE.importResult=out;toast('Import berhasil.','success');logActivitySafe({action:'IMPORT',module:'Import PDF Transfer',detail:`Import PDF Transfer ${out.sheetName} berhasil membuat sheet baru dan mengimport ${out.importedRows} SKU.`,status:'SUCCESS',metadata:{transferNumber:out.sheetName,sheetName:out.sheetName,rowCount:out.importedRows,totalQty:out.totalQty,result:'SUCCESS'}});
}catch(err){toast(err.message||'Sheet berhasil diproses tetapi data gagal diimport.','error');}finally{PDF_TRANSFER_STATE.isImporting=false;renderImportPdfTransferPage();}
}
function activityMeta(row){const m=row?.metadata&&typeof row.metadata==='object'?row.metadata:{};for(const k of ['details'])if(typeof m[k]==='string'){try{m[k]=JSON.parse(m[k]);}catch{}}return m;}
async function fetchActivityLogs(){const f=ACTIVITY_LOG_STATE.filters,qs=new URLSearchParams({limit:String(ACTIVITY_LOG_STATE.pageSize),offset:String((ACTIVITY_LOG_STATE.page-1)*ACTIVITY_LOG_STATE.pageSize)});for(const [k,v] of Object.entries(f)){if(v)qs.set(k==='user'?'user_name':k,v);}const headers=await getActivityLogAccessHeaders();const res=await fetch(`/api/activity-log?${qs}`,{headers});const data=await res.json();if(!res.ok||!data?.success)throw new Error(data?.message||'Gagal memuat log');return data.data||[];}
function activityBadge(value,kind='action'){const key=String(value||'-').toUpperCase();return `<span class="activity-badge ${kind}-${key.toLowerCase().replaceAll('_','-')}">${esc(key)}</span>`;}
function activityDetail(row){const m=activityMeta(row),changes=m.details?.changes||[];if(changes.length)return changes.map(c=>`<div class="activity-change"><b>${esc(c.field)}</b>: <del>${esc(c.oldValue??'kosong')}</del> <span>→</span> <ins>${esc(c.newValue??'kosong')}</ins></div>`).join('');return `<span>${esc(row.detail||'-')}</span>`;}
function openActivityModal(row,opener){
  const m=activityMeta(row),changes=m.details?.changes||[],action=String(row.action||'').toLowerCase().replaceAll('_','-');
  document.getElementById('activityModal')?.remove();
  const activityId=row.reference||row.id||'-',sessionId=m.sessionId||'-',entityId=m.entityId||'';
  const copyValue=(value,label)=>value&&value!=='-'?`<button class="activity-copy" type="button" data-copy="${esc(value)}" aria-label="Salin ${label}" title="Salin ${label}">⧉</button>`:'';
  document.body.insertAdjacentHTML('beforeend',`<div id="activityModal" class="activity-modal-backdrop" role="presentation"><section class="activity-modal" role="dialog" aria-modal="true" aria-labelledby="activityModalTitle" aria-describedby="activityModalDescription" tabindex="-1"><header><div><h3 id="activityModalTitle">Detail Aktivitas</h3>${activityBadge(row.action)}</div><button class="icon-btn activity-modal-close" type="button" data-close-activity aria-label="Tutup detail aktivitas">×</button></header><div class="activity-modal-body"><p id="activityModalDescription" class="activity-description action-${action}">${esc(row.detail||'-')}</p><dl><div><dt>Activity ID</dt><dd class="activity-id"><span>${esc(activityId)}</span>${copyValue(activityId,'Activity ID')}</dd></div><div><dt>Timestamp</dt><dd>${esc(new Date(row.created_at).toLocaleString('id-ID'))}</dd></div><div><dt>User / Role</dt><dd>${esc(row.user_name||'-')} <span class="activity-separator">•</span> ${esc(row.role||'-')}</dd></div><div><dt>Developer</dt><dd>${m.isDeveloper?'<span class="activity-badge developer-yes">Developer</span>':'<span class="activity-badge developer-no">Tidak</span>'}</dd></div><div><dt>Session</dt><dd class="activity-id"><span>${esc(sessionId)}</span>${copyValue(sessionId,'Session ID')}</dd></div><div><dt>Module / Page</dt><dd>${esc(row.module||'-')} <span class="activity-separator">•</span> ${esc(m.page||'-')}</dd></div><div><dt>Result</dt><dd>${activityBadge(row.status,'result')}</dd></div><div><dt>Entity</dt><dd class="activity-id"><span>${esc(m.entityType||'-')}${entityId?` · ${esc(entityId)}`:''}</span>${copyValue(entityId,'Entity ID')}</dd></div><div><dt>Source</dt><dd><span class="activity-badge activity-source">${esc(m.source||'-')}</span></dd></div></dl>${changes.length?`<section><h4>Perubahan</h4>${activityDetail(row)}</section>`:''}${m.details?.error?`<div class="state error">${esc(m.details.error)}</div>`:''}</div></section></div>`);
  const backdrop=document.getElementById('activityModal'),closeButton=backdrop.querySelector('[data-close-activity]');
  const previousOverflow=document.body.style.overflow,previousPadding=document.body.style.paddingRight,scrollbarWidth=window.innerWidth-document.documentElement.clientWidth;
  document.body.style.overflow='hidden';if(scrollbarWidth>0)document.body.style.paddingRight=`${scrollbarWidth}px`;
  const onKeydown=e=>{if(e.key==='Escape')close();};
  const close=()=>{if(backdrop.classList.contains('is-closing'))return;backdrop.classList.add('is-closing');document.removeEventListener('keydown',onKeydown);document.body.style.overflow=previousOverflow;document.body.style.paddingRight=previousPadding;setTimeout(()=>{backdrop.remove();opener?.focus();},160);};
  backdrop.onclick=e=>{if(e.target===backdrop)close();};closeButton.onclick=close;document.addEventListener('keydown',onKeydown);
  backdrop.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='✓';setTimeout(()=>button.textContent='⧉',1200);}catch{}});
  requestAnimationFrame(()=>{backdrop.classList.add('is-open');closeButton.focus();});
}
async function renderActivityLogPage(){const root=document.getElementById('activityLogApp');if(!root)return;root.innerHTML='<div class="state">Memuat aktivitas…</div>';let rows=[],err='';try{rows=await fetchActivityLogs();}catch(e){err=e.message;}const today=rows.filter(x=>new Date(x.created_at).toDateString()===new Date().toDateString()),login=today.filter(x=>['LOGIN','AUTO_LOGIN','LOGIN_SUCCESS','LOGIN_DEVELOPER'].includes(x.action)).length,crud=today.filter(x=>['CREATE','UPDATE','DELETE','BATCH_UPDATE'].includes(x.action)).length,bad=today.filter(x=>['FAILED','DENIED'].includes(x.status)).length;const actions=['','LOGIN','AUTO_LOGIN','PAGE_VIEW','CREATE','UPDATE','DELETE','CHECKLIST','UNCHECK','IMPORT','EXPORT','MOVEMENT','BATCH_UPDATE','UNDO','REDO','REFRESH','LOGOUT','SESSION_EXPIRED'];root.innerHTML=`<div class="activity-summary"><div><span>Aktivitas Hari Ini</span><b>${today.length}</b></div><div><span>Login</span><b>${login}</b></div><div><span>CRUD</span><b>${crud}</b></div><div class="activity-summary-alert"><span>Gagal / Ditolak</span><b>${bad}</b></div></div><div class="card activity-panel"><div class="activity-panel-heading"><div><h4>Riwayat Aktivitas</h4><p>Pantau seluruh aktivitas pengguna dan perubahan data.</p></div><span>${rows.length} aktivitas ditampilkan</span></div><div class="activity-filters"><label class="activity-search"><span>Pencarian</span><input id="alSearch" placeholder="Cari SKU, user, lokasi, sheet, Activity ID…" value="${esc(ACTIVITY_LOG_STATE.filters.search)}"></label><label><span>Aktivitas</span><select id="alAction">${actions.map(a=>`<option value="${a}">${a||'Semua Aktivitas'}</option>`).join('')}</select></label><label><span>Modul</span><input id="alModule" placeholder="Semua modul" value="${esc(ACTIVITY_LOG_STATE.filters.module)}"></label><label><span>User</span><input id="alUser" placeholder="Semua user" value="${esc(ACTIVITY_LOG_STATE.filters.user)}"></label><label><span>Result</span><select id="alStatus"><option value="">Semua Result</option><option>SUCCESS</option><option>FAILED</option><option>DENIED</option></select></label><label><span>Mulai tanggal</span><input id="alFrom" type="date" value="${esc(ACTIVITY_LOG_STATE.filters.from)}"></label><button id="alApply" class="btn-primary">Terapkan Filter</button></div>${err?`<div class="state error">${esc(err)}</div>`:''}<div class="table-wrap activity-table-wrap"><table class="activity-table"><thead><tr><th>Waktu</th><th>User</th><th>Aktivitas</th><th>Modul</th><th>Detail</th><th>Result</th><th><span class="sr-only">Aksi</span></th></tr></thead><tbody>${rows.length?rows.map((x,i)=>`<tr><td>${esc(formatDateTime(x.created_at))}</td><td><b>${esc(x.user_name||'-')}</b><small>${esc(x.role||'')}</small></td><td>${activityBadge(x.action)}</td><td>${esc(x.module||'-')}</td><td>${activityDetail(x)}</td><td>${activityBadge(x.status,'result')}</td><td><button class="btn-ghost" data-view-activity="${i}" aria-label="Lihat detail aktivitas">Lihat</button></td></tr>`).join(''):`<tr><td colspan="7"><div class="state">Belum ada aktivitas.</div></td></tr>`}</tbody></table></div><div class="mv-pagination activity-pagination"><span>Halaman ${ACTIVITY_LOG_STATE.page}</span><div class="row"><button id="alPrev" class="btn-ghost" ${ACTIVITY_LOG_STATE.page===1?'disabled':''}>Sebelumnya</button><button id="alNext" class="btn-ghost" ${rows.length<ACTIVITY_LOG_STATE.pageSize?'disabled':''}>Berikutnya</button></div></div></div>`;for(const id of ['Action','Status'])document.getElementById(`al${id}`).value=ACTIVITY_LOG_STATE.filters[id.toLowerCase()];document.getElementById('alApply').onclick=()=>{ACTIVITY_LOG_STATE.filters={...ACTIVITY_LOG_STATE.filters,search:alSearch.value.trim(),action:alAction.value,module:alModule.value.trim(),user:alUser.value.trim(),status:alStatus.value,from:alFrom.value};ACTIVITY_LOG_STATE.page=1;renderActivityLogPage();};document.getElementById('alPrev').onclick=()=>{ACTIVITY_LOG_STATE.page=Math.max(1,ACTIVITY_LOG_STATE.page-1);renderActivityLogPage();};document.getElementById('alNext').onclick=()=>{if(rows.length===ACTIVITY_LOG_STATE.pageSize)ACTIVITY_LOG_STATE.page++;renderActivityLogPage();};document.querySelectorAll('[data-view-activity]').forEach(b=>b.onclick=()=>openActivityModal(rows[Number(b.dataset.viewActivity)],b));}

window.showToast=(message,type="success")=>toast(message,type);

function formatDateTime(value){if(!value)return"-";return new Intl.DateTimeFormat("id-ID",{timeZone:"Asia/Jakarta",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
async function refreshSheetByLatestMerge(sheetName,{deletedRowNumbers=[]}={}){
const isMasuk=sheetName==="Barang Masuk";
const latestRows=isMasuk?await loadBarangMasuk({mode:"latest",limit:1000}):await loadBarangKeluar({mode:"latest",limit:1000});
const prevRows=isMasuk?getBarangMasukRows():getBarangKeluarRows();
const cleanedRows=deletedRowNumbers.length?removeDeletedRows(prevRows,deletedRowNumbers):prevRows;
const mergedRows=mergeLatestRows(cleanedRows,latestRows);
if(isMasuk){window.APP_STATE.barangMasuk=mergedRows;DATA["Barang Masuk"]=mergedRows;setModuleCache(MODULE_CACHE_KEYS.barangMasuk,mergedRows);}
else{window.APP_STATE.barangKeluar=mergedRows;DATA["Barang Keluar"]=mergedRows;setModuleCache(MODULE_CACHE_KEYS.barangKeluar,mergedRows);}
await saveCache(DATA);
rebuildSkuCache();
}
const ABC_STATE={periodMonths:3,orderType:"Semua",selectedTo:[],excludeTo:["REJECT","RUSAK"],sortBy:"Prioritas Order",toSearch:"",toDropdownOpen:false,selectedRows:new Set(),page:1,pageSize:25,bgComputing:false,rows:[],top10:[],toOptions:[],filteredCount:0,sourceHasData:false,lastSignature:""};
function isStoreOrder(to){const v=String(to||"").toUpperCase();return v.includes("100")||v.includes("-BT-");}
function parseDateSafe(value){const d=new Date(value);return Number.isNaN(d.getTime())?null:d;}
function toNum(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function getToValue(row){return String(getVal(row,["to","tujuan","destination"])||row?.to||"").trim();}
function computePriority(freq,stock,maxFreq){if(stock<=0&&freq>0)return "HIGH PRIORITY";if(freq>=Math.max(2,Math.ceil(maxFreq*0.6)))return "HIGH PRIORITY";if(freq>=Math.max(1,Math.ceil(maxFreq*0.3)))return "MEDIUM";return "LOW";}
function computeRekom(cat,stock,priority){if(priority==="HIGH PRIORITY"&&stock<=0)return "SEGERA ORDER";if(stock<40)return "RESTOCK PRIORITAS";if(cat==="A"&&stock>=40)return "AMAN";if(cat==="C"&&stock>=30)return "OVERSTOCK";if(cat==="C"&&stock<=5)return "LOW PRIORITY";return "NORMAL";}
function getAbcSortWeight(r){
const rekomWeight={"SEGERA ORDER":0,"RESTOCK PRIORITAS":1,"AMAN":2,"NORMAL":3,"LOW PRIORITY":4,"OVERSTOCK":5}[r?.rekom]??9;
const prioWeight={"HIGH PRIORITY":0,"MEDIUM":1,"LOW":2}[r?.priority]??9;
const abcWeight={A:0,B:1,C:2}[r?.abc]??9;
return {rekomWeight,prioWeight,abcWeight};
}
function sortAbcRows(rows){
const list=[...(rows||[])];
if(ABC_STATE.sortBy==="Paling Banyak Keluar")return list.sort((a,b)=>b.qtyKeluar-a.qtyKeluar);
if(ABC_STATE.sortBy==="Paling Sedikit Keluar")return list.sort((a,b)=>a.qtyKeluar-b.qtyKeluar);
if(ABC_STATE.sortBy==="Stok Terkecil")return list.sort((a,b)=>a.stokSaatIni-b.stokSaatIni||b.qtyKeluar-a.qtyKeluar);
if(ABC_STATE.sortBy==="Stok Terbesar")return list.sort((a,b)=>b.stokSaatIni-a.stokSaatIni||b.qtyKeluar-a.qtyKeluar);
if(ABC_STATE.sortBy==="Kategori ABC")return list.sort((a,b)=>({A:0,B:1,C:2}[a.abc]-({A:0,B:1,C:2}[b.abc])||b.qtyKeluar-a.qtyKeluar));
return list.sort((a,b)=>{
const wa=getAbcSortWeight(a),wb=getAbcSortWeight(b);
const scoreA=(wa.abcWeight===0?0:wa.abcWeight===1?1:2)+(wa.prioWeight===0?-0.4:wa.prioWeight===1?0:0.4)+(wa.rekomWeight<=1?-0.2:0);
const scoreB=(wb.abcWeight===0?0:wb.abcWeight===1?1:2)+(wb.prioWeight===0?-0.4:wb.prioWeight===1?0:0.4)+(wb.rekomWeight<=1?-0.2:0);
return scoreA-scoreB
||wa.prioWeight-wb.prioWeight
||wa.rekomWeight-wb.rekomWeight
||wa.abcWeight-wb.abcWeight
||b.qtyKeluar-a.qtyKeluar
||a.stokSaatIni-b.stokSaatIni;
});
}
function buildAbcAnalysis(){
const now=Date.now();
const keluar=getBarangKeluarRows(),stokRows=Array.isArray(DATA["Kartu Stock"])?DATA["Kartu Stock"]:(Array.isArray(DATA["Kartu Stok"])?DATA["Kartu Stok"]:[]),masuk=getBarangMasukRows();
const cutoff=new Date();cutoff.setDate(cutoff.getDate()-ABC_STATE.periodMonths*30);
const filteredByType=keluar.filter(r=>{const to=getToValue(r);if(!to)return false;if(ABC_STATE.excludeTo.some(x=>to.toUpperCase().includes(String(x).toUpperCase())))return false;const store=isStoreOrder(to);if(ABC_STATE.orderType==="Orderan Store"&&!store)return false;if(ABC_STATE.orderType==="Orderan GT"&&store)return false;return true;});
const toOptions=[...new Set(filteredByType.map(r=>getToValue(r)).filter(Boolean))].sort();
const selectedAvailable=(ABC_STATE.selectedTo||[]).filter(v=>toOptions.includes(v));
if(selectedAvailable.length!==(ABC_STATE.selectedTo||[]).length)ABC_STATE.selectedTo=[...selectedAvailable];
const selectedSet=new Set(selectedAvailable);
const filtered=filteredByType.filter(r=>{const d=parseDateSafe(r.tanggal);if(!d||d<cutoff)return false;const to=getToValue(r);if(!to)return false;if(!selectedSet.size)return true;return selectedSet.has(to);});
const bySku=new Map();let total=0;
for(const r of filtered){const sku=String(r.sku||"").trim();if(!sku)continue;const qty=toNum(r.qty);if(qty<=0)continue;const obj=bySku.get(sku)||{sku,namaBarang:String(r.namaBarang||sku),qtyKeluar:0};obj.qtyKeluar+=qty;bySku.set(sku,obj);total+=qty;}
const stockMap=new Map();for(const r of stokRows){const sku=String(getVal(r,["sku","kode sku","item code"])||r?.sku||"").trim();if(!sku)continue;const qty=parseNumber(getVal(r,["qty","stok akhir","closing stock","ending stock","saldo akhir","stok","quantity"]));if(!Number.isFinite(qty))continue;stockMap.set(sku,(stockMap.get(sku)||0)+qty);}
const freqMap=new Map();for(const r of masuk){const sku=String(r.sku||"").trim();if(!sku)continue;freqMap.set(sku,(freqMap.get(sku)||0)+1);}
const freqVals=[...freqMap.values()];const maxFreq=Math.max(1,...freqVals);
const ranked=[...bySku.values()].sort((a,b)=>b.qtyKeluar-a.qtyKeluar);
let cum=0;ranked.forEach(it=>{const pct=total?it.qtyKeluar/total:0;cum+=pct;it.kontribusi=pct;it.cum=cum;it.abc=cum<=0.8?"A":cum<=0.95?"B":"C";it.stokSaatIni=stockMap.get(it.sku)||0;it.priority=computePriority(freqMap.get(it.sku)||0,it.stokSaatIni,maxFreq);it.rekom=computeRekom(it.abc,it.stokSaatIni,it.priority);});
const rows=sortAbcRows(ranked);
const top10=ranked.filter(x=>x.abc==="A").sort((a,b)=>b.qtyKeluar-a.qtyKeluar).slice(0,10);
const sourceHasData=keluar.length>0;
const result={ts:now,key:`${ABC_STATE.periodMonths}|${ABC_STATE.orderType}|${ABC_STATE.selectedTo.join(",")}|${ABC_STATE.sortBy}`,rows,top10,toOptions,sourceHasData,filteredCount:filtered.length};
localStorage.setItem(ABC_ANALYSIS_CACHE_KEY,JSON.stringify(result));return result;
}
function getAbcRenderSignature(data){
return JSON.stringify({k:data?.key,rows:(data?.rows||[]).map(r=>[r.sku,r.qtyKeluar,r.stokSaatIni,r.abc,r.priority,r.rekom]),to:data?.toOptions||[],f:data?.filteredCount||0});
}
function readAbcCache(){const raw=localStorage.getItem(ABC_ANALYSIS_CACHE_KEY);return safeJsonParse(raw,null);}
function scheduleAbcBackgroundCompute(){
if(ABC_STATE.bgComputing)return;
ABC_STATE.bgComputing=true;updateAbcLoadingUi(true);
setTimeout(()=>{const fresh=buildAbcAnalysis();const sig=getAbcRenderSignature(fresh);const same=sig===ABC_STATE.lastSignature;ABC_STATE.bgComputing=false;updateAbcLoadingUi(false);if(same){updateAbcSummaryAndBodyOnly();return;}syncAbcStateFromData(fresh);updateAbcSummaryAndBodyOnly();},0);
}
function syncAbcStateFromData(data){
ABC_STATE.rows=data.rows||[];ABC_STATE.top10=data.top10||[];ABC_STATE.toOptions=data.toOptions||[];ABC_STATE.filteredCount=data.filteredCount||0;ABC_STATE.sourceHasData=!!data.sourceHasData;ABC_STATE.lastSignature=getAbcRenderSignature(data);
const maxPage=Math.max(1,Math.ceil(ABC_STATE.rows.length/ABC_STATE.pageSize));if(ABC_STATE.page>maxPage)ABC_STATE.page=maxPage;
}
function renderAbcAnalisisPage(forceRefresh=false){
if(!abcAnalisisApp)return;
const cached=readAbcCache();
if(cached&&!forceRefresh)syncAbcStateFromData(cached);else{ABC_STATE.rows=[];ABC_STATE.top10=[];ABC_STATE.toOptions=[];ABC_STATE.filteredCount=0;ABC_STATE.sourceHasData=true;}
renderAbcShell();
renderAbcSkeletonBody();
scheduleAbcBackgroundCompute();
}
function renderAbcShell(){
if(!abcAnalisisApp)return;
if(!ABC_STATE.sourceHasData){abcAnalisisApp.innerHTML="<div class='card'><div class='state'>Tidak ada data pada periode ini</div></div>";return;}
const periodOpt=[1,2,3,4,5,6].map(v=>`<option ${ABC_STATE.periodMonths===v?"selected":""} value="${v}">${v} bulan terakhir</option>`).join("");
const sortOpt=["Prioritas Order","Paling Banyak Keluar","Paling Sedikit Keluar","Stok Terkecil","Stok Terbesar","Kategori ABC"].map(v=>`<option ${ABC_STATE.sortBy===v?"selected":""}>${v}</option>`).join("");
const selectedToSet=new Set(ABC_STATE.selectedTo||[]);
const toOptionFiltered=(ABC_STATE.toOptions||[]).filter(v=>clean(v).includes(clean(ABC_STATE.toSearch||"")));
const toSummary=selectedToSet.size?`${selectedToSet.size} tujuan dipilih`:"Semua Tujuan";
const toListHtml=buildAbcToOptionsHtml(toOptionFiltered,selectedToSet);
abcAnalisisApp.innerHTML=`<div class='card' style='overflow:visible'><div class='mv-filters open' style='display:flex;flex-wrap:wrap;gap:8px;align-items:center;overflow:visible'><select id='abcPeriod' class='search-lg' style='max-width:170px;height:34px;padding:5px 14px!important'>${periodOpt}</select><select id='abcOrderType' class='search-lg' style='max-width:160px;height:34px;padding:5px 14px!important'><option ${ABC_STATE.orderType==="Semua"?"selected":""}>Semua</option><option ${ABC_STATE.orderType==="Orderan GT"?"selected":""}>Orderan GT</option><option ${ABC_STATE.orderType==="Orderan Store"?"selected":""}>Orderan Store</option></select><div id='abcToWrap' class='abc-to-wrap'><button id='abcToToggle' class='btn-ghost abc-action-btn abc-to-toggle' style='height:34px'><span class='abc-to-summary'>${esc(toSummary)}</span><span style="opacity:.85;font-size:12px">${ABC_STATE.toDropdownOpen?'▴':'▾'}</span></button><div id='abcToMenu' class='abc-to-menu' ${ABC_STATE.toDropdownOpen?'':'style="display:none"'}><input id='abcToSearch' class='search-lg abc-to-search' placeholder='Cari tujuan...' value='${esc(ABC_STATE.toSearch||"")}' autocomplete='off' autocapitalize='off' spellcheck='false'><div class='abc-to-actions'><button id='abcToSelectAll' class='btn-ghost abc-to-mini-btn'>Pilih semua</button><button id='abcToClear' class='btn-ghost abc-to-mini-btn'>Hapus pilihan</button></div><div id='abcToOptions' class='abc-to-options'>${toListHtml}</div></div></div><select id='abcSortBy' class='search-lg' style='max-width:190px;height:34px;padding:5px 14px!important'>${sortOpt}</select><select id='abcPageSize' class='search-lg' style='max-width:120px;height:34px;padding:5px 14px!important'><option value='25' ${ABC_STATE.pageSize===25?'selected':''}>25</option><option value='50' ${ABC_STATE.pageSize===50?'selected':''}>50</option><option value='all' ${ABC_STATE.pageSize===-1?'selected':''}>Semua</option></select><button id='abcResetBtn' class='btn-ghost abc-action-btn' style='height:34px'>Reset</button><button id='abcCopyBtn' class='btn-ghost abc-action-btn' style='height:34px'>Copy</button><button id='abcRefreshBtn' class='btn-primary abc-action-btn' style='height:34px'>Refresh</button><span id='abcLoadingBadge' class='subtitle' style='margin-left:auto'></span></div><div class='table-wrap' style='margin-top:14px;max-height:calc(100vh - 280px);overflow:auto'><table><thead><tr><th><input type='checkbox' id='abcSelectAll' class='balikan-check'></th><th>SKU</th><th>Nama Barang</th><th>Total Qty Keluar</th><th>% Kontribusi</th><th>Cumulative %</th><th>Kategori ABC</th><th>Stok Saat Ini</th><th>Priority Order</th><th>Status Rekomendasi</th></tr></thead><tbody id='abcTbody'></tbody></table></div><div id='abcPager' class='mv-pagination'></div></div><div class='card' style='margin-top:8px;padding:8px 10px'><ol id='abcTop10' style='margin:0;padding-left:16px;display:block'></ol></div>`;
const debouncedSearch=debounce(v=>{ABC_STATE.toSearch=v;updateAbcToOptionsOnly();},180);
document.getElementById("abcPeriod").onchange=e=>{ABC_STATE.periodMonths=Number(e.target.value)||3;renderAbcAnalisisPage(true);};
document.getElementById("abcOrderType").onchange=e=>{ABC_STATE.orderType=e.target.value;ABC_STATE.selectedTo=[];ABC_STATE.toSearch="";ABC_STATE.toDropdownOpen=false;renderAbcAnalisisPage(true);};
const toToggle=document.getElementById("abcToToggle");if(toToggle)toToggle.onclick=e=>{e.stopPropagation();ABC_STATE.toDropdownOpen=!ABC_STATE.toDropdownOpen;renderAbcShell();};
const toSearchEl=document.getElementById("abcToSearch");if(toSearchEl){toSearchEl.oninput=e=>{e.stopPropagation();debouncedSearch(e.target.value||"");};toSearchEl.onclick=e=>e.stopPropagation();}
document.getElementById("abcToMenu")?.addEventListener("click",e=>e.stopPropagation());
document.getElementById("abcToSelectAll")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();const filteredOptions=(ABC_STATE.toOptions||[]).filter(v=>clean(v).includes(clean(ABC_STATE.toSearch||"")));const next=new Set(ABC_STATE.selectedTo||[]);filteredOptions.forEach(v=>next.add(v));ABC_STATE.selectedTo=[...next];ABC_STATE.page=1;applyAbcToSelectionChange();});
document.getElementById("abcToClear")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();ABC_STATE.selectedTo=[];ABC_STATE.page=1;applyAbcToSelectionChange();});
bindAbcToOptionEvents();
if(!window.__abcToOutsideClickBound){document.addEventListener("click",e=>{if(!ABC_STATE.toDropdownOpen)return;const wrap=document.getElementById("abcToWrap");if(wrap&&wrap.contains(e.target))return;ABC_STATE.toDropdownOpen=false;renderAbcShell();});window.__abcToOutsideClickBound=true;}
document.getElementById("abcSortBy").onchange=e=>{ABC_STATE.sortBy=e.target.value||"Prioritas Order";renderAbcAnalisisPage(true);};
document.getElementById("abcPageSize").onchange=e=>{ABC_STATE.pageSize=e.target.value==="all"?-1:(Number(e.target.value)||25);ABC_STATE.page=1;updateAbcSummaryAndBodyOnly();};
document.getElementById("abcRefreshBtn").onclick=()=>renderAbcAnalisisPage(true);
document.getElementById("abcResetBtn").onclick=()=>{ABC_STATE.periodMonths=3;ABC_STATE.orderType="Semua";ABC_STATE.selectedTo=[];ABC_STATE.sortBy="Prioritas Order";ABC_STATE.toSearch="";ABC_STATE.toDropdownOpen=false;ABC_STATE.page=1;renderAbcAnalisisPage(true);};
document.getElementById("abcCopyBtn").onclick=()=>{const selected=(ABC_STATE.rows||[]).filter(r=>ABC_STATE.selectedRows.has(r.sku));if(!selected.length){toast("Pilih minimal 1 baris untuk di-copy","warning");return;}const lines=["SKU\tNama Barang\tTotal Qty Keluar\t% Kontribusi\tCumulative %\tKategori ABC\tStok Saat Ini\tPriority Order\tStatus Rekomendasi",...selected.map(r=>`${r.sku}\t${r.namaBarang}\t${r.qtyKeluar}\t${(r.kontribusi*100).toFixed(2)}%\t${(r.cum*100).toFixed(2)}%\t${r.abc}\t${r.stokSaatIni}\t${r.priority}\t${r.rekom}`)];navigator.clipboard.writeText(lines.join("\n")).then(()=>{toast(`${selected.length} baris ABC disalin`,`success`);logActivitySafe({action:'COPY_DATA_ABC',module:'ABC Analisis',detail:`Copy ${selected.length} baris`,status:'SUCCESS'});}).catch(()=>{toast("Gagal copy ke clipboard","error");logActivitySafe({action:'COPY_DATA_ABC',module:'ABC Analisis',detail:'Copy data ABC gagal',status:'FAILED'});});};
updateAbcSummaryAndBodyOnly();
}
function renderAbcSkeletonBody(){const tbody=document.getElementById("abcTbody");if(!tbody)return;tbody.innerHTML=Array.from({length:8}).map(()=>"<tr><td colspan='10'><div class='skeleton-line' style='height:12px;margin:8px 0'></div></td></tr>").join("");}
function buildAbcToOptionsHtml(filteredOptions,selectedToSet){
if(!filteredOptions.length)return "<div class='state abc-to-empty'>Tujuan tidak ditemukan.</div>";
return filteredOptions.map(v=>`<label class='abc-to-option'><input type='checkbox' class='balikan-check' data-abc-to='${encAttr(v)}' ${selectedToSet.has(v)?"checked":""}><span>${esc(v)}</span></label>`).join("");
}
function bindAbcToOptionEvents(){
document.querySelectorAll("[data-abc-to]").forEach(el=>{el.addEventListener("change",e=>{e.stopPropagation();const toValue=String(e.target?.dataset?.abcTo||"");if(!toValue)return;const next=new Set(ABC_STATE.selectedTo||[]);if(e.target.checked)next.add(toValue);else next.delete(toValue);ABC_STATE.selectedTo=[...next];ABC_STATE.page=1;applyAbcToSelectionChange();});});
}
function updateAbcToOptionsOnly(){
const wrap=document.getElementById("abcToWrap");
if(!wrap||!ABC_STATE.toDropdownOpen)return renderAbcShell();
const selectedToSet=new Set(ABC_STATE.selectedTo||[]);
const filtered=(ABC_STATE.toOptions||[]).filter(v=>clean(v).includes(clean(ABC_STATE.toSearch||"")));
const optionsRoot=document.getElementById("abcToOptions");
if(optionsRoot)optionsRoot.innerHTML=buildAbcToOptionsHtml(filtered,selectedToSet);
bindAbcToOptionEvents();
}
function applyAbcToSelectionChange(){
const fresh=buildAbcAnalysis();
syncAbcStateFromData(fresh);
renderAbcShell();
updateAbcSummaryAndBodyOnly();
}
function updateAbcLoadingUi(show){const el=document.getElementById("abcLoadingBadge");if(el)el.textContent=show?"Memperbarui data...":"";}
function updateAbcSummaryAndBodyOnly(){
const dataRows=ABC_STATE.rows||[];const isAllPageSize=ABC_STATE.pageSize===-1;const pageSize=isAllPageSize?Math.max(dataRows.length,1):ABC_STATE.pageSize;const start=isAllPageSize?0:(ABC_STATE.page-1)*pageSize;const pageRows=isAllPageSize?dataRows:dataRows.slice(start,start+pageSize);
const selectedInPage=pageRows.filter(r=>ABC_STATE.selectedRows.has(r.sku)).length;
const selAllEl=document.getElementById("abcSelectAll");
if(selAllEl){
selAllEl.checked=selectedInPage>0&&selectedInPage===pageRows.length;
selAllEl.indeterminate=selectedInPage>0&&selectedInPage<pageRows.length;
selAllEl.onchange=e=>{const checked=!!e.target.checked;pageRows.forEach(r=>{if(checked)ABC_STATE.selectedRows.add(r.sku);else ABC_STATE.selectedRows.delete(r.sku);});updateAbcSummaryAndBodyOnly();};
}
const tbody=document.getElementById("abcTbody");if(tbody)tbody.innerHTML=pageRows.map(r=>`<tr><td><input type='checkbox' class='balikan-check' data-abc-row='${encAttr(r.sku)}' ${ABC_STATE.selectedRows.has(r.sku)?"checked":""}></td><td>${esc(r.sku)}</td><td><button class='btn-link' data-abc-sku='${encAttr(r.sku)}'>${esc(r.namaBarang)}</button></td><td>${r.qtyKeluar}</td><td>${(r.kontribusi*100).toFixed(2)}%</td><td>${(r.cum*100).toFixed(2)}%</td><td>${r.abc}</td><td>${r.stokSaatIni}</td><td>${esc(r.priority)}</td><td>${esc(r.rekom)}</td></tr>`).join("")||"<tr><td colspan='10'><div class='state'>Tidak ada data.</div></td></tr>";
tbody?.querySelectorAll("[data-abc-row]").forEach(el=>{el.onchange=e=>{const sku=String(e.target?.dataset?.abcRow||"");if(!sku)return;if(e.target.checked)ABC_STATE.selectedRows.add(sku);else ABC_STATE.selectedRows.delete(sku);updateAbcSummaryAndBodyOnly();};});
tbody?.querySelectorAll("[data-abc-sku]").forEach(el=>{el.onclick=e=>{const sku=String(e.currentTarget?.dataset?.abcSku||"");if(!sku)return;navigateTo(`/sku/${encodeURIComponent(sku)}`);};});
const pager=document.getElementById("abcPager");const totalPage=isAllPageSize?1:Math.max(1,Math.ceil(dataRows.length/pageSize));if(pager)pager.innerHTML=`<span>Page ${isAllPageSize?1:ABC_STATE.page}/${totalPage}</span><div class='row'><button id='abcPrev' class='btn-ghost' ${isAllPageSize?"disabled":""}>Prev</button><button id='abcNext' class='btn-ghost' ${isAllPageSize?"disabled":""}>Next</button></div>`;
document.getElementById("abcPrev")?.addEventListener("click",()=>{if(isAllPageSize)return;ABC_STATE.page=Math.max(1,ABC_STATE.page-1);updateAbcSummaryAndBodyOnly();});
document.getElementById("abcNext")?.addEventListener("click",()=>{if(isAllPageSize)return;ABC_STATE.page=Math.min(totalPage,ABC_STATE.page+1);updateAbcSummaryAndBodyOnly();});
}
