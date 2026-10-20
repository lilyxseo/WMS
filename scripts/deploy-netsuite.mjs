import {readFile,appendFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('NetSuite deployment configuration unavailable');
let stage='schema';
async function sql(query){const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`NetSuite database operation failed (${response.status})`);return response.json();}
async function deploy(){
if(process.argv.includes('--inspect')){
 const checks=await sql("select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.inventory_sync_status'::regclass,'public.inventory_sync_history'::regclass) and contype='c'");
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'source_checks='+JSON.stringify(checks)+'\n');
 const state=await sql("select jsonb_build_object('table_present',to_regclass('public.netsuite') is not null,'template_count',(select count(*) from cron.job where active and command like '%/api/sync/inventory/kartu-stok%'),'sync',(select jsonb_agg(jsonb_build_object('source',source,'status',status,'last_success_at',last_success_at)) from public.inventory_sync_status where source in ('netsuite','kartu_stok')),'last_error',(select substring(error_message from '^([A-Z_]+)') from public.inventory_sync_history where source='netsuite' and status='error' order by started_at desc limit 1)) as state");
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'deployment_state='+JSON.stringify(state[0]?.state)+'\n');
 console.log(JSON.stringify(checks));
 console.log(JSON.stringify(await sql("select jobname,schedule,active from cron.job where command like '%/api/sync/inventory/%'")));
 try{const migration=await readFile(new URL('../supabase/migrations/20261020000000_netsuite_accuracy.sql',import.meta.url),'utf8');await sql('begin;'+migration+"do $$begin if not exists(select 1 from public.inventory_sync_status where source='netsuite' and locked_at is not null) and not public.acquire_inventory_sync_lock('netsuite','00000000-0000-4000-8000-000000000001',120) then raise exception 'NETSUITE_SOURCE_REGISTRATION_FAILED';end if;end$$;select public.inventory_netsuite_accuracy();rollback;");console.log('Migration SQL validated and rolled back.');}catch(error){if(error.code!=='ENOENT')throw error;}
 process.exit(0);
}
await sql(await readFile(new URL('../supabase/migrations/20261020000000_netsuite_accuracy.sql',import.meta.url),'utf8'));
console.log('NetSuite table and private accuracy query deployed.');

const checks=await sql("select c.relrowsecurity and has_table_privilege('service_role','public.netsuite','INSERT') and not has_table_privilege('authenticated','public.netsuite','SELECT') as ready from pg_class c where c.oid='public.netsuite'::regclass");
if(!checks[0]?.ready)throw Error('NetSuite schema verification failed');
const previous=await sql("select status,last_success_at,locked_at,(select count(*) from public.netsuite) as rows from public.inventory_sync_status where source='netsuite'");
let result=previous[0]?.status==='success'&&previous[0]?.last_success_at&&!previous[0]?.locked_at&&Number(previous[0]?.rows)>0?{success:true}:null;
for(let deploymentAttempt=0;deploymentAttempt<20&&!result;deploymentAttempt++){
 if(deploymentAttempt){const status=await sql("select status,last_success_at,locked_at from public.inventory_sync_status where source='netsuite'");if(status[0]?.status==='success'&&status[0]?.last_success_at&&!status[0]?.locked_at){result={success:true};break;}}
 stage='initial-dispatch';
 const dispatched=await sql('select public.dispatch_netsuite_sync() as id'),id=Number(dispatched[0]?.id);
 if(!Number.isSafeInteger(id))throw Error('NetSuite initial sync dispatch failed');
 stage='initial-result';
 let settled=false;
 for(let attempt=0;attempt<50;attempt++){
  const response=await sql(`select status_code,content from net._http_response where id=${id}`);
  if(response.length){
   settled=true;let body;try{body=JSON.parse(response[0].content||'{}');}catch{body={};}
   if(response[0].status_code===200&&body.success){result=body;break;}
   if([404,405,503].includes(response[0].status_code)||(response[0].status_code===409&&body.reason==='SYNC_ALREADY_RUNNING')){await new Promise(resolve=>setTimeout(resolve,5000));break;}
   if(response[0].status_code===null){for(let retry=0;retry<30;retry++){const status=await sql("select status,last_success_at,locked_at from public.inventory_sync_status where source='netsuite'");if(status[0]?.status==='success'&&status[0]?.last_success_at&&!status[0]?.locked_at){result={success:true};break;}if(status[0]?.status==='error')break;await new Promise(resolve=>setTimeout(resolve,2000));}if(result)break;}
   throw Error(`NetSuite initial sync failed: ${body.reason||response[0].status_code}`);
  }
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 if(!settled)throw Error('NetSuite initial sync has not confirmed');
}
if(!result)throw Error('NetSuite website endpoint has not deployed');
stage='schedule';
await sql("select cron.schedule('inventory-netsuite','20,50 * * * *','select public.dispatch_netsuite_sync()')");
const health=await sql("select jsonb_build_object('rows',(select count(*) from public.netsuite),'sources',(select jsonb_agg(jsonb_build_object('source',source,'status',status,'last_success_at',last_success_at)) from public.inventory_sync_status where source in ('netsuite','kartu_stok')),'schedule',(select schedule from cron.job where jobname='inventory-netsuite'),'ready',(public.inventory_netsuite_accuracy()->'ready')) as health");
console.log('NetSuite synchronization confirmed: '+JSON.stringify(health[0]?.health));
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'health='+JSON.stringify(health[0]?.health)+'\n');

}
await deploy().catch(async error=>{if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'failure='+stage+': '+String(error.message).replace(/[\r\n]/g,' ')+'\n');throw error;});
