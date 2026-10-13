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
export async function loadWarningData(env){
 const config=getSecretSupabaseConfig(env);
 const sync=()=>read(config,'inventory_sync_status?select=source,status,last_success_at,source_version,locked_at');
 let before=[];try{before=await sync();}catch{}
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
 let ledger=[];let ledgerError=false;
 try{
  const response=await fetch(`${config.url}/rest/v1/rpc/inventory_warning_ledger_review`,{method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
  const body=await response.json();if(!response.ok||!Array.isArray(body))throw new Error('Ledger review unavailable');ledger=body;
 }catch{ledgerError=true;}
 let after=[];try{after=await sync();}catch{}
 const rows={kartuStok:[],rpl:[],bulky:[],barangMasuk:[],barangKeluar:[]},unavailableSources=[],verification=[];
 sources.forEach(([name,source],index)=>{
  const available=results[index].status==='fulfilled',stable=available&&stableWarningSource(before,after,source.key);
  if(stable)rows[name]=results[index].value;
  else unavailableSources.push(source.table);
  verification.push({source:source.key,ready:stable,readStatus:available?null:results[index].reason?.status||null,readCode:available?'':results[index].reason?.code||'',rowCount:stable?rows[name].length:null,lastSuccess:after.find(row=>row.source===source.key)?.last_success_at||null,reason:stable?'':available?'Sinkronisasi belum terverifikasi atau berubah saat pemeriksaan.':'Sumber tidak dapat dibaca.'});
 });
 for(const key of ['barang_masuk','barang_keluar']){
  const stable=!ledgerError&&stableWarningSource(before,after,key);
  verification.push({source:key,ready:stable,lastSuccess:after.find(row=>row.source===key)?.last_success_at||null,reason:stable?'':'Riwayat transaksi belum terverifikasi.'});
  if(!stable)unavailableSources.push(key);
 }
 const ledgerReady=!unavailableSources.length;
 if(!ledgerReady)ledger=[]; // A failed/changed stock source cannot prove absence.
 if(results.every(result=>result.status==='rejected')){const error=new Error('All warning stock sources unavailable');error.failures=sources.map(([,source])=>({source:source.table}));throw error;}
 return {rows,ledger,unavailableSources:[...new Set(unavailableSources)],verification,ledgerReady};
}
