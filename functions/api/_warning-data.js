import {getSecretSupabaseConfig} from './_supabase-config.js';
export const WARNING_SOURCES={kartuStok:{table:'inventory_kartu_stok',key:'kartu_stok'},rpl:{table:'inventory_rpl',key:'rpl'},bulky:{table:'inventory_bulky',key:'bulky'}};
const base='id,sku,nama_barang,lokasi_bulky,stok_akhir,source_row_number';
async function read(config,path,{count=false}={}){
 const response=await fetch(`${config.url}/rest/v1/${path}`,{headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,...(count?{Prefer:'count=exact'}:{})},signal:AbortSignal.timeout(20000)});
 const body=await response.json().catch(()=>null);
 if(!response.ok){const error=new Error('Warning source unavailable');error.code=body?.code;error.status=response.status;throw error;}
 if(!Array.isArray(body))throw new Error('Invalid warning source response');
 if(!count)return body;const raw=String(response.headers.get('content-range')||'').split('/')[1];return {rows:body,total:/^\d+$/.test(raw||'')?Number(raw):null};
}
export function stableWarningSource(before,after,key){
 const a=before.find(row=>row.source===key),b=after.find(row=>row.source===key);
 return !!(a&&b&&a.status==='success'&&b.status==='success'&&a.last_success_at&&b.last_success_at&&!a.locked_at&&!b.locked_at&&(a.source_version||a.last_success_at)===(b.source_version||b.last_success_at));
}
export function verifiedWarningSnapshot(before,after,key,proofBefore=[],proofAfter=[]){
 if(stableWarningSource(before,after,key))return {ready:true,stale:false};
 const a=before.find(row=>row.source===key),b=after.find(row=>row.source===key);
 const unchanged=a&&b&&a.status==='error'&&b.status==='error'&&!a.locked_at&&!b.locked_at&&a.last_success_at&&a.last_success_at===b.last_success_at&&a.source_version===b.source_version&&/^[a-f0-9]{64}$/.test(a.source_version||'');
 const first=proofBefore.find(row=>row.source===key),last=proofAfter.find(row=>row.source===key);
 const ready=!!(unchanged&&first&&last&&first.content_version===a.source_version&&last.content_version===a.source_version&&first.row_count===last.row_count);
 return {ready,stale:ready};
}
export async function loadWarningData(env){
 const config=getSecretSupabaseConfig(env);
 if(env.WMS_WARNING_ATOMIC_READ==='true')return loadAtomicWarningData(config);
 const sync=()=>read(config,'inventory_sync_status?select=*');
 let before=[];try{before=await sync();}catch{}
 const signatures=async()=>{try{const response=await fetch(`${config.url}/rest/v1/rpc/inventory_warning_snapshot_signatures`,{method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});const body=await response.json();return response.ok&&Array.isArray(body)?body:[];}catch{return [];}};
 const needsProof=before.some(row=>row.status==='error');
 const proofBefore=needsProof?await signatures():[];
 const sources=Object.entries(WARNING_SOURCES);
 const results=await Promise.allSettled(sources.map(async([name,source])=>{
  let select=base+',stok_awal,internal_stock_transfer,replenishment,pengeluaran'+(name==='kartuStok'?'':',netsuite,selisih');
  const rows=[];let total=null;
  for(let offset=0;;){
   let batch;try{const result=await read(config,`${source.table}?${new URLSearchParams({select,order:'source_row_number.asc,id.asc',offset:String(offset),limit:'1000'})}`,{count:offset===0});if(offset===0){batch=result.rows;total=result.total;}else batch=result;}
   catch(error){if(select!==base&&['42703','PGRST204'].includes(error.code)){select=base;rows.length=0;total=null;offset=0;continue;}throw error;}
   rows.push(...batch);
   if(total!==null){if(rows.length>total)throw new Error('Snapshot count changed');if(rows.length===total)return rows;if(!batch.length)throw new Error('Incomplete stock snapshot');}
   else if(batch.length<1000)return rows;
   offset+=batch.length;
  }
 }));
 let ledger=[];let ledgerError=false;let movement=null;let movementError=false;
 try{
  const response=await fetch(`${config.url}/rest/v1/rpc/inventory_warning_ledger_review`,{method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
  const body=await response.json();if(!response.ok||!Array.isArray(body))throw new Error('Ledger review unavailable');ledger=body;
 }catch{ledgerError=true;}
 try{
  const response=await fetch(`${config.url}/rest/v1/rpc/inventory_warning_movement_context`,{method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
  const body=await response.json();if(!response.ok||!Array.isArray(body?.movements)||!Array.isArray(body?.activity))throw new Error('Movement context unavailable');movement=body;
 }catch{movementError=true;}
 let after=[];try{after=await sync();}catch{}
 const proofAfter=needsProof?await signatures():[];
 const rows={kartuStok:[],rpl:[],bulky:[],barangMasuk:[],barangKeluar:[]},unavailableSources=[],verification=[];
 sources.forEach(([name,source],index)=>{
  const available=results[index].status==='fulfilled',snapshot=verifiedWarningSnapshot(before,after,source.key,proofBefore,proofAfter),stable=available&&snapshot.ready;
  if(stable)rows[name]=results[index].value;
  else unavailableSources.push(source.table);
  verification.push({source:source.key,ready:stable,stale:stable&&snapshot.stale,readStatus:available?null:results[index].reason?.status||null,readCode:available?'':results[index].reason?.code||'',rowCount:stable?rows[name].length:null,lastSuccess:after.find(row=>row.source===source.key)?.last_success_at||null,reason:stable?(snapshot.stale?'Snapshot sinkronisasi terakhir terverifikasi; sinkronisasi terbaru gagal.':''):available?'Sinkronisasi belum terverifikasi atau berubah saat pemeriksaan.':'Sumber tidak dapat dibaca.'});
 });
 for(const key of ['barang_masuk','barang_keluar']){
  const snapshot=verifiedWarningSnapshot(before,after,key,proofBefore,proofAfter),stable=!ledgerError&&snapshot.ready;
  verification.push({source:key,ready:stable,stale:stable&&snapshot.stale,lastSuccess:after.find(row=>row.source===key)?.last_success_at||null,reason:stable?(snapshot.stale?'Snapshot riwayat terakhir terverifikasi; sinkronisasi terbaru gagal.':''):'Riwayat transaksi belum terverifikasi.'});
  if(!stable)unavailableSources.push(key);
 }
 const ledgerReady=!unavailableSources.length;
 const movementReady=ledgerReady&&!movementError;
 if(movementError)unavailableSources.push('movement_impact');
 if(!movementReady)movement=null;
 if(!ledgerReady)ledger=[]; // A failed/changed stock source cannot prove absence.
 if(results.every(result=>result.status==='rejected')){const error=new Error('All warning stock sources unavailable');error.failures=sources.map(([,source])=>({source:source.table}));throw error;}
 const staleSources=verification.filter(item=>item.stale).map(item=>item.source);
 return {rows,ledger,staleSources,unavailableSources:[...new Set(unavailableSources)],verification,ledgerReady,movement,movementReady};
}

export function atomicWarningSource(sync,signatures,key){
 const status=sync.find(item=>item.source===key),proof=signatures.find(item=>item.source===key);
 const ready=!!(status?.last_success_at&&/^[a-f0-9]{64}$/.test(status.source_version||'')&&proof?.content_version===status.source_version);
 return {source:key,ready,stale:ready&&(status.status!=='success'||!!status.locked_at),rowCount:ready?proof.row_count:null,lastSuccess:status?.last_success_at||null,reason:ready?'Data dibaca atomik dan checksum cocok dengan sinkronisasi terakhir.':'Checksum data belum cocok dengan snapshot sinkronisasi terakhir.'};
}
async function loadAtomicWarningData(config){
 const response=await fetch(config.url+'/rest/v1/rpc/inventory_warning_detection_data',{method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)}),data=await response.json();
 if(!response.ok||!data?.stocks||!Array.isArray(data.sync)||!Array.isArray(data.signatures))throw Error('Atomic warning snapshot unavailable');
 const keys=['kartu_stok','rpl','bulky','barang_masuk','barang_keluar'],verification=keys.map(key=>atomicWarningSource(data.sync,data.signatures,key)),rows={kartuStok:[],rpl:[],bulky:[],barangMasuk:[],barangKeluar:[]};
 for(const [name,source]of Object.entries(WARNING_SOURCES)){const check=verification.find(item=>item.source===source.key),stock=data.stocks[name];if(!Array.isArray(stock)||check.rowCount!==stock.length){check.ready=false;check.reason='Snapshot stok tidak lengkap.';}if(check.ready)rows[name]=stock;}
 const unavailableSources=verification.filter(item=>!item.ready).map(item=>item.source),ledgerReady=!unavailableSources.length&&data.ledgerAvailable===true,movementReady=ledgerReady&&data.movementAvailable===true&&Array.isArray(data.movement?.movements)&&Array.isArray(data.movement?.activity);
 if(!data.ledgerAvailable)unavailableSources.push('ledger_review');if(!movementReady)unavailableSources.push('movement_impact');
 return {rows,ledger:ledgerReady?data.ledger:[],ledgerReady,movement:movementReady?data.movement:null,movementReady,verification,unavailableSources,staleSources:verification.filter(item=>item.stale&&item.ready).map(item=>item.source)};
}
