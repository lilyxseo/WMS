import {appendFile,readFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;if(!project||!token)throw Error('Sync deployment configuration unavailable');
async function sql(query){const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Sync database operation failed (${response.status})`);return response.json();}
const migration=await readFile(new URL('../supabase/migrations/20261023010000_sync_pipeline.sql',import.meta.url),'utf8');
const checks=`do $$declare lease uuid:=gen_random_uuid();proof jsonb;rejected boolean:=false;begin
 perform 1 from public.inventory_sync_status where source='kartu_stok' for update;
 update public.inventory_sync_status set status='success',locked_at=null,lock_id=null,source_version=repeat('a',64),last_full_sync_at=now() where source='kartu_stok';
 proof:=public.acquire_inventory_sync_fast('kartu_stok',lease,120);
 if proof->>'acquired'<>'true' or proof->>'allow_fast'<>'true' or proof->>'source_version'<>repeat('a',64) then raise exception 'Clean proof unavailable';end if;
 perform public.finish_inventory_sync_fast('kartu_stok',lease,7482,0,0,0,1,repeat('a',64),false);
 update public.inventory_sync_status set status='error' where source='kartu_stok';
 proof:=public.acquire_inventory_sync_fast('kartu_stok',lease,120);if proof->>'allow_fast'='true' then raise exception 'Failed run treated as clean';end if;
 perform public.finish_inventory_sync_fast('kartu_stok',lease,7482,0,0,0,1,repeat('a',64),true);
 update public.inventory_sync_status set last_full_sync_at=now()-interval '11 minutes' where source='kartu_stok';
 proof:=public.acquire_inventory_sync_fast('kartu_stok',lease,120);if proof->>'allow_fast'='true' then raise exception 'Full comparison interval ignored';end if;
 if public.inventory_client_versions()->>'kartuStokVersion'<>repeat('a',64) then raise exception 'Committed version changed while locked';end if;
 if has_function_privilege('anon','public.request_inventory_refresh(text[])','EXECUTE') or has_function_privilege('authenticated','public.inventory_client_versions()','EXECUTE') then raise exception 'Public sync access';end if;
 begin perform public.request_inventory_refresh(array['not-a-source']);exception when others then rejected:=true;end;
 if not rejected then raise exception 'Invalid dispatch source accepted';end if;
 delete from public.inventory_refresh_requests where source='kartu_stok';
 proof:=public.request_inventory_refresh(array['kartu_stok']);if proof->>'dispatched'<>'1' then raise exception 'Immediate dispatch unavailable';end if;
 proof:=public.request_inventory_refresh(array['kartu_stok']);if proof->>'dispatched'<>'0' then raise exception 'Duplicate dispatch not coalesced';end if;
end$$;`;
if(process.argv.includes('--inspect'))await sql('begin;'+migration+checks+'rollback;');
else if(process.argv.includes('--configure')){
 await sql('begin;'+migration+'commit;');await sql('begin;'+checks+'rollback;');
 await sql(`do $$declare task record;begin for task in select jobid from cron.job where active and substring(command from '/api/sync/inventory/([a-z-]+)') in ('kartu-stok','barang-masuk','barang-keluar','rpl','bulky') loop perform cron.alter_job(task.jobid,schedule:='* * * * *',active:=true);end loop;for task in select jobid from cron.job where jobname='inventory-netsuite' loop perform cron.alter_job(task.jobid,schedule:='*/5 * * * *',active:=true);end loop;end$$`);
}
const state=await sql(`select jsonb_build_object(
 'jobs',(select jsonb_agg(jsonb_build_object('job',jobname,'schedule',schedule,'active',active,'source',substring(command from '/api/sync/inventory/([a-z-]+)'),'host',substring(command from 'https://([a-zA-Z0-9.-]+)'))) from cron.job where command like '%/api/sync/inventory/%' or jobname like 'inventory-%'),
 'sources',(select jsonb_agg(jsonb_build_object('source',source,'status',status,'lastSuccess',last_success_at,'locked',locked_at,'hasVersion',source_version is not null,'lastFull',to_jsonb(s)->>'last_full_sync_at')) from public.inventory_sync_status s),
 'transport',(select jsonb_agg(to_jsonb(t)) from (select status_code,timed_out,created,substring(content from '"source"[[:space:]]*:[[:space:]]*"([a-z_]+)"') as source,content ~ '"fastPath"[[:space:]]*:[[:space:]]*true' as fast_path,(content like '%1102%' or content ilike '%too many subrequests%') as worker_limit from net._http_response order by created desc limit 20) t),
 'recent',(select jsonb_agg(to_jsonb(h)) from (select source,status,duration_ms,source_row_count,substring(error_message from '^([A-Z_]+)') as error_code from public.inventory_sync_history order by started_at desc limit 18) h)) as state`);
const result=JSON.stringify(state[0]?.state||{});if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`result=${result}\n`);console.log('Read-only synchronization metadata inspected.');
