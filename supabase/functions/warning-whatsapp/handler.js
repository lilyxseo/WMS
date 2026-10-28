import {readWarningSnapshot} from '../../../functions/api/_warning-snapshot.js';
import {normalizeWarningSku} from '../../../functions/api/_inventory-warnings.js';
const identityText=value=>normalizeWarningSku(value).replace(/\s+/g,' ');
export function fingerprint(row){
 const grouped=['NAME_MISMATCH','ACCURACY_MISMATCH','OUTBOUND_WITHOUT_INBOUND'].includes(row.category);
 // Sheet positions and regenerated database IDs are not business identities.
 return JSON.stringify(grouped?[row.category,identityText(row.sku)]:[row.category,identityText(row.source),identityText(row.sku),identityText(row.location),...(['MOVEMENT_NOT_REFLECTED','MOVEMENT_NO_EFFECT'].includes(row.category)?[row.eventDate||'']:[]),...(identityText(row.sku)==='-'||!identityText(row.sku)?[identityText(row.namaBarang)]:[])]);
}
export function contentSignature(row){return 'v2:'+JSON.stringify(['category','severity','confidence','sku','namaBarang','location','issue'].map(key=>String(row[key]??'').trim()).concat([JSON.stringify((row.nameVariants||[]).map(item=>[identityText(item.name),item.count]).sort((a,b)=>a[0].localeCompare(b[0])))]));}
const text=(value,max=280)=>String(value||'').slice(0,max);
export function formatMessage(events){
 const labels={new:'🆕 Baru',updated:'🔄 Diperbarui',resolved:'✅ Selesai',reopened:'⚠️ Muncul kembali'};
 return ['📣 *Update Warning WMS*',...events.map(event=>{const row=event.warning||event,type=event.event_type||'new';return `\n*${labels[type]||labels.new}*\n*${text(row.sku,70)} • ${text(row.namaBarang,120)}*\n${row.confidence==='review'?'Perlu verifikasi':text(row.categoryLabel,90)}\n${row.location?`Lokasi: ${text(row.location,90)}\n`:''}${type==='resolved'?'Temuan tidak terdeteksi lagi pada pemeriksaan lengkap terbaru.\nSebelumnya: ':''}${text(row.issue)}${type==='updated'&&event.previous_warning?.issue&&event.previous_warning.issue!==row.issue?`\nSebelumnya: ${text(event.previous_warning.issue,180)}`:''}`;}),'\nDetail: https://gotoliving.app/warning'].join('\n');
}
const complete=result=>!result.partial&&!result.snapshotStale&&Array.isArray(result.rows)&&result.verification?.length===5&&result.verification.every(source=>source.ready);
export function createHandler(env,{load=readWarningSnapshot,fetchFn=fetch}={}){
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
   try{const result=await load(config,{full:true});return Response.json({ready:complete(result),total:result.total,recipients:recipients.length,delivery:'not_sent'});}catch{return Response.json({code:'SNAPSHOT_UNAVAILABLE',delivery:'not_sent'},{status:503});}
  }
  const run=crypto.randomUUID();let claimed=false;
  try{
   claimed=await rpc('warning_notify_lock',{p_run:run});if(!claimed)return Response.json({status:'busy'});
   const result=await load(config,{full:true});
   if(!complete(result))return Response.json({status:'sources_unavailable',delivery:'not_sent'});
   const findings=[...new Map(result.rows.map(row=>[fingerprint(row),{fingerprint:fingerprint(row),content_signature:contentSignature(row),warning:row}])).values()];
   const reconciled=await rpc('warning_notify_collect',{p_run:run,p_findings:findings,p_recipients:recipients,p_initialize:body.action==='initialize'});
   if(body.action==='initialize')return Response.json({status:'initialized',...reconciled,delivery:'not_sent'});
   let accepted=0;
   for(let batch=0;batch<4;batch++){
    const events=await rpc('warning_notify_claim',{p_run:run});if(!events.length)break;
    const permitted=await rpc('notification_allowed_numbers',{p_kind:'warning'});if(!permitted.includes(events[0].recipient)){await rpc('notification_cancel_revoked');continue;}
    let status='uncertain';
    try{
     const response=await fetchFn('https://api.fonnte.com/send',{method:'POST',headers:{Authorization:env.FONNTE_TOKEN},body:new URLSearchParams({target:events[0].recipient,message:formatMessage(events),countryCode:'62'}),signal:AbortSignal.timeout(10000)});
     const payload=await response.json();
     if(response.ok&&payload.status===true){status='sent';accepted+=events.length;}
     else if(payload.status===false)status='failed';
    }catch{}
    await rpc('warning_notify_finish',{p_run:run,p_ids:events.map(e=>e.id),p_status:status});
   }
   return Response.json({status:'checked',accepted,...reconciled});
  }catch{return Response.json({code:'WARNING_CHECK_FAILED'},{status:503});}
  finally{if(claimed)await rpc('warning_notify_unlock',{p_run:run}).catch(()=>{});}
 };
}
