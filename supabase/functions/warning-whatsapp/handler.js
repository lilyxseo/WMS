import {readWarningSnapshot} from '../../../functions/api/_warning-snapshot.js';
import {normalizeWarningSku} from '../../../functions/api/_inventory-warnings.js';
const identityText=value=>normalizeWarningSku(value).replace(/\s+/g,' ');
export function fingerprint(row){
 const grouped=['NAME_MISMATCH','ACCURACY_MISMATCH','OUTBOUND_WITHOUT_INBOUND'].includes(row.category);
 // Sheet positions and regenerated database IDs are not business identities.
 return JSON.stringify(grouped?[row.category,identityText(row.sku)]:[row.category,identityText(row.source),identityText(row.sku),identityText(row.location),...(['MOVEMENT_NOT_REFLECTED','MOVEMENT_NO_EFFECT','INVALID_OUTBOUND_FROM'].includes(row.category)?[row.category==='INVALID_OUTBOUND_FROM'?(row.eventDate||'')+'|'+(row.transactionTo||''):row.eventDate||'']:[]),...(identityText(row.sku)==='-'||!identityText(row.sku)?[identityText(row.namaBarang)]:[])]);
}
export function contentSignature(row){const base='v2:'+JSON.stringify(['category','severity','confidence','sku','namaBarang','location','issue'].map(key=>String(row[key]??'').trim()).concat([JSON.stringify((row.nameVariants||[]).map(item=>[identityText(item.name),item.count]).sort((a,b)=>a[0].localeCompare(b[0])))]));const entry=row.deductionTrace?.primary;return base+(entry?':deduction:'+JSON.stringify([!!row.deductionTrace.confirmed,entry.source,entry.eventDate||entry.date,entry.from,entry.to,entry.qty,entry.before,entry.after]):'');}
const text=(value,max=280)=>String(value||'').slice(0,max);
export function formatMessage(events){
 const labels={new:'🆕 Baru',updated:'🔄 Diperbarui',resolved:'✅ Selesai',reopened:'⚠️ Muncul kembali'};
 return ['📣 *Update Warning WMS*',...events.map(event=>{const row=event.warning||event,type=event.event_type||'new';return `\n*${labels[type]||labels.new}*\n*${text(row.sku,70)} • ${text(row.namaBarang,120)}*\n${row.confidence==='review'?'Perlu verifikasi':text(row.categoryLabel,90)}\n${row.location?`Lokasi: ${text(row.location,90)}\n`:''}${type==='resolved'?'Temuan tidak terdeteksi lagi pada pemeriksaan lengkap terbaru.\nSebelumnya: ':''}${text(row.issue)}${row.deductionTrace?.primary?`\n${row.deductionTrace.confirmed?'Pemotongan melewati nol':'Pemotongan terkait (verifikasi)'}: ${text(row.deductionTrace.primary.source,30)} · ${text(row.deductionTrace.primary.date,20)} · baris ${text(row.deductionTrace.primary.row,12)} · Qty ${text(row.deductionTrace.primary.qty,20)}\nTo / Tujuan: ${text(row.deductionTrace.primary.to||'—',120)}`:''}${type==='updated'&&event.previous_warning?.issue&&event.previous_warning.issue!==row.issue?`\nSebelumnya: ${text(event.previous_warning.issue,180)}`:''}`;}),'\nDetail: https://gotoliving.app/warning'].join('\n');
}
export function splitWarningMessages(events,maxLength=3500){const groups=[];let group=[];for(const event of events){if(group.length&&formatMessage([...group,event]).length>maxLength){groups.push(group);group=[];}group.push(event);}if(group.length)groups.push(group);return groups;}
const complete=result=>!result.partial&&!result.snapshotStale&&Array.isArray(result.rows)&&result.verification?.length===5&&result.verification.every(source=>source.ready&&!source.stale);
const sourceKeys={'Kartu Stok':'kartu_stok',RPL:'rpl',BULKY:'bulky','Barang Masuk':'barang_masuk','Barang Keluar':'barang_keluar'};
export function observableWarnings(result){
 if(result.snapshotStale||!Array.isArray(result.rows))return [];
 const fresh=new Set((result.verification||[]).filter(source=>source.ready&&!source.stale).map(source=>source.source));
 const all=['kartu_stok','rpl','bulky','barang_masuk','barang_keluar'];
 return result.rows.filter(row=>{let required;
  if(row.category==='INVALID_OUTBOUND_FROM')required=row.fromReason==='unknown'?['kartu_stok','barang_keluar']:['barang_keluar'];
  else if(['OUTBOUND_WITHOUT_INBOUND','MOVEMENT_NOT_REFLECTED','MOVEMENT_NO_EFFECT'].includes(row.category)){const check=row.category==='OUTBOUND_WITHOUT_INBOUND'?'ledger':'movement';if(!result.checks?.some(item=>item.key===check&&item.ready))return false;required=all;}
  else if(row.category==='ACCURACY_MISMATCH')required=['kartu_stok','rpl','bulky'];
  else if(['NEGATIVE_STOCK','STOCK_BALANCE_MISMATCH','EMPTY_SKU','EMPTY_NAME','EMPTY_LOCATION','NAME_MISMATCH'].includes(row.category))required=String(row.source||'').split(' / ').map(source=>sourceKeys[source]);
  else return false;
  return required.length>0&&required.every(source=>source&&fresh.has(source));
 });
}
export function createHandler(env,{load=readWarningSnapshot,fetchFn=fetch,now=Date.now,maxBatches=40,budgetMs=90000}={}){
 const config={...env,SUPABASE_SECRET_KEY:env.WMS_WARNING_DATA_KEY};
 const rpc=async(name,args={})=>{
  const response=await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.WMS_WARNING_DATA_KEY,Authorization:`Bearer ${env.WMS_WARNING_DATA_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Warning state unavailable');return response.json();
 };
 return async request=>{
  if(request.method!=='POST'||!env.WMS_WARNING_NOTIFY_SECRET||request.headers.get('X-WMS-Warning-Secret')!==env.WMS_WARNING_NOTIFY_SECRET)return new Response('Unauthorized',{status:401});
  const body=await request.json().catch(()=>({}));
  let recipients;try{recipients=await rpc('notification_allowed_numbers',{p_kind:'warning'});if(!Array.isArray(recipients))throw Error();if(body.action!=='check')await rpc('notification_cancel_revoked');}catch{return Response.json({code:'ACCESS_UNAVAILABLE',delivery:'not_sent'},{status:503});}
  if(!recipients.length)return Response.json({status:'no_recipients',delivery:'not_sent'});
  if(!recipients.length||!env.FONNTE_TOKEN||!env.WMS_WARNING_DATA_KEY)return Response.json({code:'CONFIG_MISSING'},{status:503});
  if(body.action==='check'){
   try{const result=await load(config,{full:true,notifications:true}),observable=observableWarnings(result);return Response.json({ready:complete(result),observable:observable.length,total:result.total,recipients:recipients.length,snapshotStale:!!result.snapshotStale,snapshotPublishedAt:result.snapshotPublishedAt||null,verification:(result.verification||[]).map(({source,ready,stale})=>({source,ready,stale})),delivery:'not_sent'});}catch{return Response.json({code:'SNAPSHOT_UNAVAILABLE',delivery:'not_sent'},{status:503});}
  }
  const run=crypto.randomUUID();let claimed=false,continuation=false,stage='lock';
  try{
   claimed=await rpc('warning_notify_lock',{p_run:run});if(!claimed)return Response.json({status:'busy'});
   stage='snapshot';const result=await load(config,{full:true,notifications:true});
   const full=complete(result),observed=full?result.rows:observableWarnings(result);
   if(!full&&!observed.length)return Response.json({status:'sources_unavailable',delivery:'not_sent'});
   if(!full&&body.action==='initialize')return Response.json({status:'sources_unavailable',delivery:'not_sent'});
   const findings=[...new Map(observed.map(row=>[fingerprint(row),{fingerprint:fingerprint(row),content_signature:contentSignature(row),warning:row}])).values()];
   stage='collect';const reconciled=await rpc(full?'warning_notify_collect':'warning_notify_observe',{p_run:run,p_findings:findings,p_recipients:recipients,...(full?{p_initialize:body.action==='initialize'}:{})});
   if(body.action==='initialize')return Response.json({status:'initialized',...reconciled,delivery:'not_sent'});
   stage='recover_recipients';const recovered=await rpc('warning_notify_enqueue_missing',{p_run:run,p_findings:findings,p_recipients:recipients});
   let accepted=0,messages=0,failed=0,uncertain=0,empty=false,batches=0;const started=now();
   while(batches<maxBatches&&now()-started<budgetMs){
    stage='claim';const events=await rpc(full?'warning_notify_claim':'warning_notify_claim_observed',{p_run:run,...(full?{}:{p_findings:findings})});if(!events.length){empty=true;break;}batches++;
    for(const group of splitWarningMessages(events)){
     stage='recipient_access';const permitted=await rpc('notification_allowed_numbers',{p_kind:'warning'});if(!permitted.includes(group[0].recipient)){await rpc('notification_cancel_revoked');continue;}
     stage='provider';let status='uncertain';
     try{const response=await fetchFn('https://api.fonnte.com/send',{method:'POST',headers:{Authorization:env.FONNTE_TOKEN},body:new URLSearchParams({target:group[0].recipient,message:formatMessage(group),countryCode:'62'}),signal:AbortSignal.timeout(10000)}),payload=await response.json();if(response.ok&&payload.status===true){status='sent';accepted+=group.length;messages++;}else if(payload.status===false)status='failed';}catch{}
     if(status==='failed')failed+=group.length;else if(status==='uncertain')uncertain+=group.length;
     stage='finish';await rpc('warning_notify_finish',{p_run:run,p_ids:group.map(event=>event.id),p_status:status});
    }
   }
   continuation=!empty;
   return Response.json({status:'checked',partial:!full,accepted,messages,failed,uncertain,recovered:Number.isInteger(recovered)?recovered:0,continuation,...reconciled});
  }catch{return Response.json({code:'WARNING_CHECK_FAILED',stage},{status:503});}
  finally{if(claimed){let unlocked=false;try{await rpc('warning_notify_unlock',{p_run:run});unlocked=true;}catch{}if(unlocked&&continuation)await rpc('dispatch_warning_notifications').catch(()=>{});}}
 };
}
