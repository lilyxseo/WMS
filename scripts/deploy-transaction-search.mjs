import {readFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('Transaction search deployment configuration unavailable');
let query=await readFile(new URL('../supabase/migrations/20261019000000_transaction_search.sql',import.meta.url),'utf8');
query+=await readFile(new URL('../supabase/migrations/20261031000000_inventory_search_fast.sql',import.meta.url),'utf8');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok){const detail=await response.json().catch(()=>({}));const reason=String(detail.message||detail.error||'Unknown database error').replace(/https?:\/\/\S+/g,'[URL]').slice(0,1200);console.error(`::error::Transaction search migration failed: HTTP ${response.status}; ${reason}`);process.exit(1);}
console.log('Private transaction search RPCs and trigram indexes deployed. No stock or ledger rows changed.');
