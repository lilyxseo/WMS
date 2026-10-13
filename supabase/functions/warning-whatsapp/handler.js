import {loadInventoryWarnings,normalizeWarningSku} from '../../../functions/api/_inventory-warnings.js';
export function fingerprint(row){
 const grouped=['NAME_MISMATCH','ACCURACY_MISMATCH','OUTBOUND_WITHOUT_INBOUND'].includes(row.category);
 return JSON.stringify(grouped?[row.category,normalizeWarningSku(row.sku)]:[row.category,row.source,row.sourceRecord??row.sourceRow??row.location,normalizeWarningSku(row.sku)]);
}
export function formatMessage(rows){
 return ['⚠️ *Warning WMS • Baru*',...rows.map(row=>`\n*${row.sku} • ${row.namaBarang}*\n${row.confidence==='review'?'Perlu verifikasi':row.categoryLabel}\n${row.location?`Lokasi: ${row.location}\n`:''}${row.issue}`),'\nDetail: https://wms-duj.pages.dev/warning'].join('\n');
}
export function createHandler(env,{load=loadInventoryWarnings,fetchFn=fetch}={}){
 const config={...env,SUPABASE_SECRET_KEY:env.WMS_WARNING_DATA_KEY};
 const rpc=async(name,args={})=>{
  const response=await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.WMS_WARNING_DATA_KEY,Authorization:`Bearer ${env.WMS_WARNING_DATA_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Warning state unavailable');return response.json();
 };
 return async request=>{
  if(request.method!=='POST'||!env.WMS_WARNING_NOTIFY_SECRET||request.headers.get('X-WMS-Warning-Secret')!==env.WMS_WARNING_NOTIFY_SECRET)return new Response('Unauthorized',{status:401});
  const body=await request.json().catch(()=>({}));
  const recipients=[...new Set(String(env.WMS_WARNING_RECIPIENTS||'').split(',').map(v=>v.trim()).filter(v=>/^62\d{8,13}$/.test(v)))];
  if(!recipients.length||!env.FONNTE_TOKEN||!env.WMS_WARNING_DATA_KEY)return Response.json({code:'CONFIG_MISSING'},{status:503});
  if(body.action==='check'){
   const result=await load(config,{full:true});return Response.json({ready:!result.partial,total:result.total,recipients:recipients.length,delivery:'not_sent'});
  }
  const run=crypto.randomUUID();
  if(!await rpc('warning_notify_lock',{p_run:run}))return Response.json({status:'busy'});
  try{
   const result=await load(config,{full:true});
   if(result.partial)return Response.json({status:'sources_unavailable',delivery:'not_sent'});
   const findings=[...new Map(result.rows.map(row=>[fingerprint(row),{fingerprint:fingerprint(row),warning:row}])).values()];
   const reconciled=await rpc('warning_notify_collect',{p_run:run,p_findings:findings,p_recipients:recipients,p_initialize:body.action==='initialize'});
   if(body.action==='initialize')return Response.json({status:'initialized',...reconciled,delivery:'not_sent'});
   let accepted=0;
   for(let batch=0;batch<4;batch++){
    const events=await rpc('warning_notify_claim',{p_run:run});if(!events.length)break;
    let status='uncertain';
    try{
     const response=await fetchFn('https://api.fonnte.com/send',{method:'POST',headers:{Authorization:env.FONNTE_TOKEN},body:new URLSearchParams({target:events[0].recipient,message:formatMessage(events.map(e=>e.warning)),countryCode:'62'}),signal:AbortSignal.timeout(10000)});
     const payload=await response.json();
     if(response.ok&&payload.status===true){status='sent';accepted+=events.length;}
     else if(payload.status===false)status='failed';
    }catch{}
    await rpc('warning_notify_finish',{p_run:run,p_ids:events.map(e=>e.id),p_status:status});
   }
   return Response.json({status:'checked',accepted,...reconciled});
  }catch{return Response.json({code:'WARNING_CHECK_FAILED'},{status:503});}
  finally{await rpc('warning_notify_unlock',{p_run:run}).catch(()=>{});}
 };
}
