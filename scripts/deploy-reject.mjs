import {readFile,appendFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw Error('Reject deployment configuration unavailable');
const migration=await readFile(new URL('../supabase/migrations/20261020010000_reject_workspace.sql',import.meta.url),'utf8'),inspect=process.argv.includes('--inspect');
const query=(inspect?'begin;':'')+migration+`do $$begin if not public.acquire_reject_write_lock('00000000-0000-4000-8000-000000000001') then raise exception 'lock not acquired';end if;if public.acquire_reject_write_lock('00000000-0000-4000-8000-000000000002') then raise exception 'overlapping lock acquired';end if;perform public.release_reject_write_lock('00000000-0000-4000-8000-000000000002');if public.acquire_reject_write_lock('00000000-0000-4000-8000-000000000002') then raise exception 'foreign lock release';end if;perform public.release_reject_write_lock('00000000-0000-4000-8000-000000000001');end$$;`+(inspect?'rollback;':'');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error(`Reject schema validation failed (${response.status})`);
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'result='+ (inspect?'Schema and lock checks passed; rolled back.':'Reject lock and unique SKU counter deployed.')+'\n');
console.log('Reject schema and overlapping-writer checks passed. No inventory transactions written.');
