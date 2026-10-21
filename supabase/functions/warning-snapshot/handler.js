import {loadInventoryWarnings} from '../../../functions/api/_inventory-warnings.js';
export function createHandler(env,{load=loadInventoryWarnings,fetchFn=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const key=env.WMS_WARNING_SNAPSHOT_DATA_KEY;
 const rpc=async(name,body)=>{const response=await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Snapshot persistence unavailable');return response.json();};
 return async request=>{
  if(!env.WMS_WARNING_SNAPSHOT_SECRET||request.headers.get('X-WMS-Snapshot-Secret')!==env.WMS_WARNING_SNAPSHOT_SECRET)return Response.json({success:false},{status:401});
  if(request.method!=='POST')return Response.json({success:false},{status:405});
  if(!key?.startsWith('sb_secret_'))return Response.json({success:false},{status:503});
  const run=crypto.randomUUID();let claimed=false;
  try{claimed=await rpc('warning_snapshot_claim',{p_run:run});if(!claimed)return Response.json({success:true,status:'busy'});
   let result;for(let attempt=0;attempt<3;attempt++){result=await load({...env,SUPABASE_SECRET_KEY:key,WMS_WARNING_ATOMIC_READ:'true'},{full:true});if(!result.unavailableSources?.length&&result.verification?.length===5&&result.verification.every(item=>item.ready))break;if(attempt<2)await pause(8000);}
   const published=await rpc('warning_snapshot_publish',{p_run:run,p_payload:result});
   return Response.json({success:true,status:published?'published':'retained',total:result.summary?.total,ready:result.verification?.filter(item=>item.ready).length,partial:result.partial});
  }catch{if(claimed)await rpc('warning_snapshot_fail',{p_run:run}).catch(()=>{});return Response.json({success:false,code:'SNAPSHOT_REFRESH_FAILED'},{status:503});}
 };
}
