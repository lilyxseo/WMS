import {readFile,appendFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw Error('Archive deployment configuration unavailable');
async function sql(query){const res=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});if(!res.ok)throw Error(`Archive schema operation failed (${res.status})`);return res.json();}
const migration=await readFile(new URL('../supabase/migrations/20261021010000_archive_spreadsheets.sql',import.meta.url),'utf8');
const verify=`do $$begin
 if not (select relrowsecurity from pg_class where oid='public.archive_spreadsheets'::regclass) then raise exception 'RLS disabled';end if;
 if has_table_privilege('anon','public.archive_spreadsheets','SELECT') or has_table_privilege('authenticated','public.archive_spreadsheets','INSERT') or has_table_privilege('authenticated','public.archive_spreadsheets','SELECT') then raise exception 'Public archive access';end if;
 if not has_table_privilege('service_role','public.archive_spreadsheets','SELECT,INSERT,DELETE') then raise exception 'Server privileges missing';end if;
end$$;`;
const inspect=process.argv.includes('--inspect');await sql('begin;'+migration+verify+(inspect?'rollback;':'commit;'));
const result=inspect?'Schema validated with rollback':'Private registry ready';
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`result=${result}\n`);
console.log(result+'. No spreadsheet or inventory data modified.');
