import {readFile} from 'node:fs/promises';

const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw Error('Inventory history deployment configuration unavailable');
async function sql(query){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)
 });
 if(!response.ok)throw Error(`Inventory history deployment failed (HTTP ${response.status})`);
 return response.json();
}

const migration=await readFile(new URL('../supabase/migrations/20261128000000_inventory_daily_history.sql',import.meta.url),'utf8');
await sql(`begin;${migration}commit;`);
await sql(`do $$declare existing bigint;begin
 select jobid into existing from cron.job where jobname='wms-inventory-daily-history';
 if existing is null then
  perform cron.schedule('wms-inventory-daily-history','55-59 16 * * *','select public.capture_inventory_daily_history()');
 else
  perform cron.alter_job(existing,schedule:='55-59 16 * * *',command:='select public.capture_inventory_daily_history()',active:=true);
 end if;
end$$;`);
const result=await sql('select public.capture_inventory_daily_history() as captured');
console.log(result[0]?.captured?'Initial verified inventory history captured.':'Daily history scheduled. Initial capture skipped because a snapshot exists or sources are pending verification.');
