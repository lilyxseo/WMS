import {readFile,appendFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw Error('Account work deployment configuration unavailable');
async function sql(query){const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Account work schema operation failed (${response.status})`);return response.json();}
const migration=await readFile(new URL('../supabase/migrations/20261026000000_operations_and_work_drafts.sql',import.meta.url),'utf8');
const checks=`do $$declare a jsonb;b jsonb;test_owner text:='schema-test:'||gen_random_uuid();begin
 if not(select relrowsecurity from pg_class where oid='public.wms_work_drafts'::regclass) or not(select relrowsecurity from pg_class where oid='public.wms_operations'::regclass) then raise exception 'RLS missing';end if;
 if has_table_privilege('authenticated','public.wms_work_drafts','SELECT') or has_table_privilege('anon','public.wms_operations','INSERT') or has_function_privilege('authenticated','public.wms_save_work_draft(text,text,bigint,jsonb)','EXECUTE') then raise exception 'Private work data exposed';end if;
 a:=public.wms_save_work_draft(test_owner,'movement',0,'{"version":1,"items":[]}'::jsonb);if a->>'conflict'<>'false' or a#>>'{draft,revision}'<>'1' then raise exception 'Initial CAS failed';end if;
 b:=public.wms_save_work_draft(test_owner,'movement',0,null);if b->>'conflict'<>'true' or b#>'{draft,payload}'='null'::jsonb then raise exception 'Stale draft overwrote data';end if;
 a:=public.wms_save_work_draft(test_owner,'movement',1,null);if a#>>'{draft,revision}'<>'2' then raise exception 'Tombstone revision missing';end if;
 b:=public.wms_save_work_draft(test_owner,'movement',1,'{"version":1,"items":[]}'::jsonb);if b->>'conflict'<>'true' or b#>'{draft,payload}'<>'null'::jsonb then raise exception 'Completed draft resurrected';end if;
 if exists(select 1 from public.wms_work_drafts where owner=test_owner||':other') then raise exception 'Owner isolation failed';end if;
 insert into public.wms_operations(owner,user_name,role,action,module,endpoint,method) values(test_owner,'Schema check','Test','UPDATE','Test','/api/test','PATCH');
end$$;`;
if(process.argv.includes('--inspect'))await sql('begin;'+migration+checks+'rollback;');else{await sql('begin;'+migration+'commit;');await sql('begin;'+checks+'rollback;');}
const result=process.argv.includes('--inspect')?'Private schema and CAS validated with rollback':'Private account drafts and server operation registry ready';if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`result=${result}\n`);console.log(result+'. No warehouse transactions written.');
