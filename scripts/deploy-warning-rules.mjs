import {readFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('Warning deployment configuration unavailable');
const query=await readFile(new URL('../supabase/migrations/20261013020000_verified_inventory_warning_review.sql',import.meta.url),'utf8');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok){console.error(`::error::Warning RPC deployment failed: HTTP ${response.status}`);process.exit(1);}
console.log('Verified warning review RPC deployed. No stock or ledger rows changed.');
