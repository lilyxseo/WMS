import {readFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('Stock entry deployment configuration missing');
const query=await readFile(new URL('../supabase/migrations/20261017000000_stock_entry_batches.sql',import.meta.url),'utf8');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok){console.error(`::error::Stock entry migration failed: HTTP ${response.status}`);process.exit(1);}
const verification=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:"select c.relrowsecurity and has_table_privilege('service_role','public.stock_entry_batches','INSERT') and not has_table_privilege('authenticated','public.stock_entry_batches','SELECT') as ready from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='stock_entry_batches';"}),signal:AbortSignal.timeout(30000)});
const rows=await verification.json().catch(()=>[]);if(!verification.ok||rows[0]?.ready!==true){console.error('::error::Stock entry receipts verification failed');process.exit(1);}
console.log('Stock entry receipts and RLS deployed. No inventory transactions written.');
