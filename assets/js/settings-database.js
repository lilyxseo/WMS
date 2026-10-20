export const DATABASE_SOURCES=Object.freeze([
 {key:'kartu_stok',syncKey:'kartuStok',label:'Kartu Stok'},
 {key:'barang_masuk',syncKey:'barangMasuk',label:'Barang Masuk'},
 {key:'barang_keluar',syncKey:'barangKeluar',label:'Barang Keluar'},
 {key:'rpl',syncKey:'rpl',label:'RPL'},
 {key:'bulky',syncKey:'bulky',label:'BULKY'},
 {key:'netsuite',syncKey:'netsuite',label:'NetSuite'},
]);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
export function databaseSyncDate(value){const date=new Date(value);return value&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(date)+' WIB':'Belum pernah sinkron';}
export function databaseStatus(row){
 if(row?.locked_at||row?.status==='syncing')return {label:'Sedang sinkron',kind:'pending'};
 if(['error','failed'].includes(row?.status))return {label:'Gagal',kind:'error'};
 if(row?.status==='success'&&row.last_success_at&&Number.isFinite(new Date(row.last_success_at).getTime()))return {label:'Siap',kind:'ok'};
 return {label:'Belum sinkron',kind:'empty'};
}
export async function readDatabaseStatus(fetchFn=fetch,signal){
 const response=await fetchFn('/api/inventory-sync-status?all=1',{cache:'no-store',signal});
 const data=await response.json();if(!response.ok||!data.success||!Array.isArray(data.sources))throw new Error('Status database belum dapat dimuat.');
 return data.sources;
}
export function mountSettingsDatabase(root,{fetchFn=fetch,synchronize,canSync=()=>false,isBusy=()=>false,isActive=()=>true,generation=()=>0,onChange=()=>{}}={}){
 let rows=[],loaded=false,loading=false,syncing=false,error='',progress='',lastResult=null,requestId=0,disposed=false,timer,controller;
 const owner=generation();
 const valid=()=>!disposed&&owner===generation();
 const snapshot=()=>({rows,loaded,loading,syncing,error,lastResult});
 function render(){
  if(!valid())return;
  const ready=rows.filter(row=>databaseStatus(row).kind==='ok').length;
  const latest=rows.map(row=>row.last_success_at).filter(Boolean).sort().at(-1);
  const retry=Object.entries(lastResult?.sources||{}).filter(([,r])=>!r.success&&!r.skipped).map(([name])=>name);
  const busy=syncing||isBusy();
  root.innerHTML=`<div class="settings-db-overview"><div><small>Database</small><strong>Supabase</strong></div><div><small>Sinkron berhasil terakhir</small><strong>${loaded?esc(databaseSyncDate(latest)):loading?'Memuat status…':'Belum tersedia'}</strong></div><span class="settings-db-count">${error?'Status belum terverifikasi':busy?'Sinkronisasi berlangsung':loaded?`${ready}/${DATABASE_SOURCES.length} sumber siap`:'Status belum tersedia'}</span></div>
  <div class="settings-db-list">${DATABASE_SOURCES.map(source=>{const row=rows.find(r=>r.source===source.key),status=databaseStatus(row);return `<div class="settings-db-source"><div><strong>${source.label}</strong><small>${loaded?esc(databaseSyncDate(row?.last_success_at)):'Menunggu status'}</small></div><span class="settings-db-badge ${status.kind}">${error?'Belum terverifikasi':loaded?status.label:'—'}</span></div>`;}).join('')}</div>
  <p class="settings-db-feedback ${error?'is-error':''}" role="status" aria-live="polite">${esc(error||progress||(loading?'Memperbarui status…':busy?'Sinkronisasi lain sedang berjalan…':'Google Sheets → database WMS.'))}</p>
  <div class="row settings-actions"><button type="button" class="btn-primary" data-db-sync ${busy||!canSync()?'disabled':''}>${syncing?'Menyinkronkan…':'Sinkron sekarang'}</button><button type="button" class="btn-ghost" data-db-status ${loading||syncing?'disabled':''}>${loading?'Memuat…':'Perbarui status'}</button>${retry.length?`<button type="button" class="btn-ghost" data-db-retry ${busy||!canSync()?'disabled':''}>Coba yang gagal (${retry.length})</button>`:''}</div>${!canSync()?'<small class="settings-note">Sinkronisasi manual tersedia untuk PIC atau Developer.</small>':''}`;
  root.querySelector('[data-db-status]').onclick=refresh;
  root.querySelector('[data-db-sync]').onclick=()=>run();
  const retryButton=root.querySelector('[data-db-retry]');if(retryButton)retryButton.onclick=()=>run(retry);
  onChange(snapshot());
 }
 async function refresh(){
  if(!valid())return;
  clearTimeout(timer);controller?.abort();controller=new AbortController();const currentController=controller,id=++requestId;
  loading=true;error='';render();const timeout=setTimeout(()=>currentController.abort(),20000);
  try{const incoming=await readDatabaseStatus(fetchFn,currentController.signal);if(!valid()||id!==requestId)return;rows=[...new Map(incoming.filter(row=>DATABASE_SOURCES.some(s=>s.key===row.source)).map(row=>[row.source,row])).values()];loaded=true;}
  catch(e){if(valid()&&id===requestId)error='Status database belum dapat dimuat. Gunakan Perbarui status untuk mencoba lagi.';}
  finally{clearTimeout(timeout);if(valid()&&id===requestId){loading=false;render();if(!syncing&&rows.some(row=>databaseStatus(row).kind==='pending'))timer=setTimeout(()=>{if(isActive())void refresh();},15000);}}
 }
 async function run(onlySources){
  if(!valid()||syncing||isBusy()||!canSync())return;
  syncing=true;error='';progress='Menyiapkan sinkronisasi…';render();
  try{
   const result=await synchronize(({name,index,total})=>{if(valid()){progress=`${index}/${total} • ${DATABASE_SOURCES.find(s=>s.syncKey===name)?.label||name}`;render();}},onlySources);
   if(!valid())return;
   lastResult=result;
   const outcomes=Object.values(result.sources||{}),succeeded=outcomes.filter(r=>r.success).length,pending=outcomes.filter(r=>r.skipped).length;
   progress=result.success?`${succeeded} sumber berhasil disinkronkan.`:`${succeeded}/${outcomes.length} berhasil${pending?`, ${pending} sedang diproses oleh sinkronisasi lain`:''}. Periksa status setiap sumber.`;
  }catch(e){if(valid()){error=e.message||'Sinkronisasi belum terkonfirmasi. Perbarui status sebelum mencoba lagi.';progress='';}}
  finally{if(valid()){syncing=false;render();await refresh();}}
 }
 render();void refresh();
 return {refresh,render,snapshot,dispose(){disposed=true;requestId++;clearTimeout(timer);controller?.abort();}};
}
