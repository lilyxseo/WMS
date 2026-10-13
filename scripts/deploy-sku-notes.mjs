import {readFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF;
const token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('Supabase deployment configuration missing');
const query=(await Promise.all(['20261013000000_shared_sku_notes.sql','20261013010000_delete_own_sku_notes.sql'].map(file=>readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8')))).join('\n');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok){console.error(`::error::SKU notes migration failed: HTTP ${response.status}`);process.exit(1);}
const check=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:"select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='sku_notes' and c.relrowsecurity) and has_table_privilege('service_role','public.sku_notes','DELETE') as notes_ready;"}),signal:AbortSignal.timeout(30000)});
const result=await check.json().catch(()=>[]);
if(!check.ok||result?.[0]?.notes_ready!==true){console.error('::error::Shared SKU notes schema verification failed');process.exit(1);}
console.log('Shared SKU notes schema and RLS verified. No inventory transactions changed.');
