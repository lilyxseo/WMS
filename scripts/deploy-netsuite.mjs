import {readFile,appendFile} from 'node:fs/promises';
import {syncNetsuite,fetchNetsuiteValues,parseNetsuiteValues} from '../functions/api/sync/inventory/_netsuite-service.js';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN,inspect=process.argv.includes('--inspect');
if(!project||!token)throw new Error('NetSuite deployment configuration unavailable');
let stage='schema';
async function sql(query){const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`NetSuite database operation failed (${response.status})`);return response.json();}
async function deploy(){
if(inspect){
 const checks=await sql("select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.inventory_sync_status'::regclass,'public.inventory_sync_history'::regclass) and contype='c'");
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'source_checks='+JSON.stringify(checks)+'\n');
 const state=await sql("select jsonb_build_object('table_present',to_regclass('public.netsuite') is not null,'template_count',(select count(*) from cron.job where active and command like '%/api/sync/inventory/kartu-stok%'),'sync',(select jsonb_agg(jsonb_build_object('source',source,'status',status,'last_success_at',last_success_at)) from public.inventory_sync_status where source in ('netsuite','kartu_stok')),'last_error',(select substring(error_message from '^([A-Z_]+)') from public.inventory_sync_history where source='netsuite' and status='error' order by started_at desc limit 1)) as state");
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'deployment_state='+JSON.stringify(state[0]?.state)+'\n');
 console.log(JSON.stringify(checks));
 console.log(JSON.stringify(await sql("select jobname,schedule,active from cron.job where command like '%/api/sync/inventory/%'")));
 try{const migration=await readFile(new URL('../supabase/migrations/20261020000000_netsuite_accuracy.sql',import.meta.url),'utf8');await sql('begin;'+migration+"do $$begin if not exists(select 1 from public.inventory_sync_status where source='netsuite' and locked_at is not null) and not public.acquire_inventory_sync_lock('netsuite','00000000-0000-4000-8000-000000000001',120) then raise exception 'NETSUITE_SOURCE_REGISTRATION_FAILED';end if;end$$;select public.inventory_netsuite_accuracy();rollback;");console.log('Migration SQL validated and rolled back.');}catch(error){if(error.code!=='ENOENT')throw error;}

}
if(!inspect&&!process.argv.includes('--sync'))await sql(await readFile(new URL('../supabase/migrations/20261020000000_netsuite_accuracy.sql',import.meta.url),'utf8'));
const checks=await sql("select c.relrowsecurity and has_table_privilege('service_role','public.netsuite','INSERT') and not has_table_privilege('authenticated','public.netsuite','SELECT') as ready from pg_class c where c.oid='public.netsuite'::regclass");
if(!checks[0]?.ready)throw Error('NetSuite schema verification failed');
stage='google-auth';
const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${project}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
if(!keysResponse.ok)throw Error('Server synchronization credential unavailable');
const key=(await keysResponse.json()).find(item=>item.api_key?.startsWith('sb_secret_'))?.api_key;
if(!key)throw Error('Server synchronization credential unavailable');
const auth=await fetch(`https://${project}.supabase.co/functions/v1/app-google-auth`,{method:'POST',headers:{apikey:key,'X-WMS-Server-Key':key},signal:AbortSignal.timeout(30000)}),credentials=await auth.json();
if(!auth.ok||typeof credentials.access_token!=='string')throw Error('Google authentication unavailable');
stage='source-verification';
const config=await readFile(new URL('../assets/js/config.js',import.meta.url),'utf8');
const spreadsheet=process.env.SHEET_ID_2026||config.match(/export const SPREADSHEET_ID = "([^"]+)"/)?.[1];
if(!spreadsheet)throw Error('2026 spreadsheet configuration unavailable');
const source=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet)}?fields=sheets.properties.title`,{headers:{Authorization:`Bearer ${credentials.access_token}`},signal:AbortSignal.timeout(30000)}),metadata=await source.json();
if(!source.ok||!metadata.sheets?.some(sheet=>sheet.properties?.title==='2 SOH NETSUITE'))throw Error('NetSuite tab not found in configured 2026 spreadsheet');
if(inspect){const parsed=await parseNetsuiteValues(await fetchNetsuiteValues({SHEET_ID_2026:spreadsheet},{getGoogleAccessToken:async()=>credentials.access_token}));if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'source_report='+JSON.stringify({rows:parsed.rows.length,reportDate:parsed.rows[0]?.report_date})+'\n');return;}
stage='synchronization';
const result=await syncNetsuite({SUPABASE_URL:`https://${project}.supabase.co`,SUPABASE_SECRET_KEY:key,SHEET_ID_2026:spreadsheet},{getGoogleAccessToken:async()=>credentials.access_token});
if(!result.success&&!result.skipped)throw Error('NetSuite synchronization failed');
if(result.skipped){let confirmed=false;for(let attempt=0;attempt<30;attempt++){const rows=await sql("select status,locked_at,last_success_at from public.inventory_sync_status where source='netsuite'");if(rows[0]?.status==='success'&&!rows[0]?.locked_at&&rows[0]?.last_success_at){confirmed=true;break;}await new Promise(resolve=>setTimeout(resolve,2000));}if(!confirmed)throw Error('Overlapping NetSuite synchronization not confirmed');}
stage='verification';
const health=await sql("select jsonb_build_object('rows',(select count(*) from public.netsuite),'sources',(select jsonb_agg(jsonb_build_object('source',source,'status',status,'last_success_at',last_success_at)) from public.inventory_sync_status where source in ('netsuite','kartu_stok')),'schedule','GitHub Actions: 20,50 * * * *','ready',(public.inventory_netsuite_accuracy()->'ready')) as health");
console.log('NetSuite synchronization confirmed: '+JSON.stringify(health[0]?.health));
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'health='+JSON.stringify(health[0]?.health)+'\n');

}
await deploy().catch(async error=>{if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'failure='+stage+': '+String(error.message).replace(/[\r\n]/g,' ')+'\n');throw error;});
