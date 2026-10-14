import {readFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('Warning deployment configuration unavailable');
const query=(await Promise.all(['20261013020000_verified_inventory_warning_review.sql','20261014000000_movement_impact_warning.sql'].map(file=>readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')))).join('\n');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok){console.error(`::error::Warning RPC deployment failed: HTTP ${response.status}`);process.exit(1);}
console.log('Verified warning review RPC deployed. No stock or ledger rows changed.');
