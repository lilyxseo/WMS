const sourceKeys={kartuStok:'kartu_stok',barangMasuk:'barang_masuk',barangKeluar:'barang_keluar',rpl:'rpl',bulky:'bulky',netsuite:'netsuite'};
const transient=new Set(['SYNC_FAILED','GOOGLE_READ_CONNECTION_FAILED','GOOGLE_RATE_LIMITED','SUPABASE_CONNECTION_FAILED','SUPABASE_RATE_LIMITED','SUPABASE_UNAVAILABLE','TIMEOUT','NETWORK_ERROR']);
export function createInventoryRefreshCoordinator(){
 const inFlight=new Map();let queue=Promise.resolve();
 return async function synchronize({jobs,fetchJson,onProgress=()=>{},shouldContinue=()=>true,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),owner='',now=Date.now}={}){
  const started=now(),sources={};let completed=0;
  const request=async(url,options={})=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.method==='POST'?90000:15000);try{return await fetchJson(url,{cache:'no-store',...options,signal:controller.signal,silentInvalidJson:true});}finally{clearTimeout(timer);}};
  const status=async()=>{try{const {res,data}=await request('/api/inventory-sync-status?all=1');return res.ok&&data?.success&&Array.isArray(data.sources)?data.sources:[];}catch{return [];}};
  const baseline=await status();
  async function run(name,url){
   let prior=baseline.find(row=>row.source===sourceKeys[name]);
   for(let attempt=0;attempt<3;attempt++){
    if(!shouldContinue())return {success:false,reason:'SESSION_CHANGED'};
    let result;try{result=await request(url,{method:'POST'});}catch(error){result={res:{ok:false,status:0},data:{reason:error?.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR'}};}
    const {res,data}=result;if(res.ok&&data?.success===true)return {...data,success:true};
    const reason=data?.reason||data?.message||`HTTP_${res.status}`,busy=reason==='SYNC_ALREADY_RUNNING',retryable=busy||transient.has(reason)||[0,408,429,502,503,504].includes(res.status)||res.status===500&&!data?.reason;
    if(!retryable)return {...data,success:false,reason};
    let last=null;
    // A timed-out POST may still finish on the server. Confirm its commit before retrying.
    for(const delay of [1000,2000,3000,5000,8000]){
     if(!shouldContinue())return {success:false,reason:'SESSION_CHANGED'};await pause(delay);
     const rows=await status(),row=rows.find(row=>row.source===sourceKeys[name]);if(!row)break;last=row;
     if(row.status==='success'&&!row.locked_at&&row.last_success_at&&prior&&row.last_success_at!==prior.last_success_at)return {success:true,joinedExisting:true,source:row.source,lastSuccessAt:row.last_success_at};
     if(row.status!=='syncing'&&!row.locked_at)break;
    }
    if(last?.status==='syncing'&&last.locked_at){const age=now()-Date.parse(last.locked_at);if(Number.isFinite(age)&&age>=-30000&&age<120000)return {success:false,pending:true,skipped:true,reason:'SYNC_ALREADY_RUNNING',source:last.source};}
    if(attempt===2)return {...data,success:false,reason};
    prior=last||prior;await pause(attempt?3000:1000);
   }
  }
  for(const [name,url]of jobs){
   const key=owner+':'+name;let task=inFlight.get(key);
   if(!task){task=queue.then(()=>run(name,url));queue=task.catch(()=>{});inFlight.set(key,task);task.finally(()=>{if(inFlight.get(key)===task)inFlight.delete(key);}).catch(()=>{});}
   try{sources[name]=await task;}catch{sources[name]={success:false,reason:'SYNC_FAILED'};}
   completed++;onProgress({name,index:completed,total:jobs.length});
  }
  const outcomes=Object.values(sources),successful=outcomes.filter(row=>row.success).length;
  return {success:outcomes.length>0&&successful===outcomes.length,partialSuccess:successful>0&&successful<outcomes.length,pending:outcomes.some(row=>row.pending),sources,durationMs:now()-started};
 };
}
