import {readFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('NetSuite deployment configuration unavailable');
async function sql(query){const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`NetSuite database operation failed (${response.status})`);return response.json();}
if(process.argv.includes('--inspect')){
 console.log(JSON.stringify(await sql("select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.inventory_sync_status'::regclass,'public.inventory_sync_history'::regclass) and contype='c'")));
 console.log(JSON.stringify(await sql("select jobname,schedule,active from cron.job where command like '%/api/sync/inventory/%'")));
 process.exit(0);
}
await sql(await readFile(new URL('../supabase/migrations/20261020000000_netsuite_accuracy.sql',import.meta.url),'utf8'));
console.log('NetSuite table and private accuracy query deployed.');
