import {appendFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;if(!project||!token)throw Error('Sync deployment configuration unavailable');
async function sql(query){const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Sync database operation failed (${response.status})`);return response.json();}
const state=await sql(`select jsonb_build_object(
 'jobs',(select jsonb_agg(jsonb_build_object('job',jobname,'schedule',schedule,'active',active,'source',substring(command from '/api/sync/inventory/([a-z-]+)'))) from cron.job where command like '%/api/sync/inventory/%' or jobname like 'inventory-%'),
 'sources',(select jsonb_agg(jsonb_build_object('source',source,'status',status,'lastSuccess',last_success_at,'locked',locked_at,'hasVersion',source_version is not null)) from public.inventory_sync_status),
 'recent',(select jsonb_agg(to_jsonb(h)) from (select source,status,duration_ms,source_row_count,substring(error_message from '^([A-Z_]+)') as error_code from public.inventory_sync_history order by started_at desc limit 18) h)) as state`);
const result=JSON.stringify(state[0]?.state||{});if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`result=${result}\n`);console.log('Read-only synchronization metadata inspected.');
