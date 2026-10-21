import {readFile,appendFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;if(!project||!token)throw Error('Snapshot deployment configuration unavailable');
const base=`https://api.supabase.com/v1/projects/${project}`;
async function manage(path,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Snapshot management operation failed (${response.status})`);const text=await response.text();return text.trim()?JSON.parse(text):[];}
const sql=query=>manage('/database/query',{query}),literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const output=async(name,value)=>{if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,name+'='+JSON.stringify(value)+'\n');};
const migration=await readFile(new URL('../supabase/migrations/20261021000000_warning_snapshot.sql',import.meta.url),'utf8');
const stateTests=`begin;delete from public.inventory_warning_snapshot;insert into public.inventory_warning_snapshot(id) values(true);
do $$declare owner uuid:=gen_random_uuid();other uuid:=gen_random_uuid();sample jsonb;begin
 if not public.warning_snapshot_claim(owner) or public.warning_snapshot_claim(other) then raise exception 'Concurrent claim';end if;
 sample:=jsonb_build_object('rows','[{"sku":"TEST"}]'::jsonb,'verification','[{"ready":true}]'::jsonb,'partial',true,'checkedAt',now());
 if not public.warning_snapshot_publish(owner,sample) then raise exception 'Initial verified partial snapshot unavailable';end if;
 if not public.warning_snapshot_claim(other) then raise exception 'Lease release';end if;
 if public.warning_snapshot_publish(other,jsonb_set(sample,'{rows}','[]')) then raise exception 'Partial replaced existing snapshot';end if;
 if (select jsonb_array_length(payload->'rows') from public.inventory_warning_snapshot where id)<>1 then raise exception 'Previous snapshot lost';end if;
end$$;rollback;`;
if(process.argv.includes('--inspect')){
 await sql('begin;'+migration+'rollback;');
 const {loadInventoryWarnings}=await import('../functions/api/_inventory-warnings.js');
 const keys=await manage('/api-keys?reveal=true'),key=keys.find(item=>item.api_key?.startsWith('sb_secret_'))?.api_key;if(!key)throw Error('Snapshot data credential unavailable');
 const result=await loadInventoryWarnings({SUPABASE_URL:`https://${project}.supabase.co`,SUPABASE_SECRET_KEY:key},{full:true});
 await output('result',{mode:'inspect',ready:result.verification.filter(item=>item.ready).length,total:result.summary.total,partial:result.partial,sources:result.verification.map(item=>({source:item.source,ready:item.ready,readCode:item.readCode,reason:item.reason}))});
 console.log('Read-only snapshot detection inspected; schema changes rolled back.');
}else if(process.argv.includes('--configure')){
 await sql(migration);await sql(stateTests);
 const existing=await sql("select decrypted_secret from vault.decrypted_secrets where name='wms_warning_snapshot_secret' limit 1"),secret=existing[0]?.decrypted_secret||randomBytes(32).toString('hex');
 if(!existing.length)await sql(`select vault.create_secret(${literal(secret)},'wms_warning_snapshot_secret')`);
 const endpoint=`https://${project}.supabase.co/functions/v1/warning-snapshot`;
 await sql(`do $$begin if not exists(select 1 from vault.secrets where name='wms_warning_snapshot_url') then perform vault.create_secret(${literal(endpoint)},'wms_warning_snapshot_url');end if;end$$`);
 const keys=await manage('/api-keys?reveal=true'),key=keys.find(item=>item.api_key?.startsWith('sb_secret_'))?.api_key;if(!key)throw Error('Snapshot data credential unavailable');
 await manage('/secrets',[{name:'WMS_WARNING_SNAPSHOT_SECRET',value:secret},{name:'WMS_WARNING_SNAPSHOT_DATA_KEY',value:key}]);
 console.log('Private snapshot schema and retention tests ready. No inventory data or notifications modified.');
}else{
 const secret=(await sql("select decrypted_secret from vault.decrypted_secrets where name='wms_warning_snapshot_secret' limit 1"))[0]?.decrypted_secret;if(!secret)throw Error('Snapshot authentication unavailable');
 const endpoint=`https://${project}.supabase.co/functions/v1/warning-snapshot`,denied=await fetch(endpoint,{method:'POST'});if(denied.status!==401)throw Error('Snapshot worker must reject anonymous calls');
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-WMS-Snapshot-Secret':secret},body:'{}',signal:AbortSignal.timeout(240000)}),result=await response.json();if(!response.ok||!result.success)throw Error('Initial snapshot refresh failed');
 await sql("do $$begin if not exists(select 1 from cron.job where jobname='wms-warning-snapshot') then perform cron.schedule('wms-warning-snapshot','2-59/5 * * * *','select public.dispatch_warning_snapshot()');end if;end$$");
 const state=(await sql("select jsonb_build_object('stored',payload is not null,'rows',jsonb_array_length(payload->'rows'),'ready',(select count(*) from jsonb_array_elements(payload->'verification') v where v->>'ready'='true'),'partial',payload->'partial','schedule',(select schedule from cron.job where jobname='wms-warning-snapshot' and active),'last_error',last_error) as state from public.inventory_warning_snapshot where id"))[0]?.state;
 await output('result',state);if(!state?.stored||!state?.schedule)throw Error('Stored warning snapshot not ready');console.log('Server warning snapshot stored and scheduled. No WhatsApp messages sent.');
}
