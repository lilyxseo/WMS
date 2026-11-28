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

const migration=await readFile(new URL('../supabase/migrations/20261128010000_inventory_history_from_ledger.sql',import.meta.url),'utf8');
await sql(`begin;${migration}
do $$declare existing bigint;begin
 select jobid into existing from cron.job where jobname='wms-inventory-daily-history';
 if existing is not null then perform cron.unschedule(existing);end if;
end$$;
commit;`);
console.log('Warehouse history now reads dated ledger data. Automatic daily capture is disabled.');
