import {readFile,appendFile} from 'node:fs/promises';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw Error('File deployment configuration unavailable');
async function sql(query){const res=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});if(!res.ok)throw Error(`File schema operation failed (${res.status})`);return res.json();}
const migration=await readFile(new URL('../supabase/migrations/20261022000000_file_bin.sql',import.meta.url),'utf8');
const verify=`do $$begin
 if not (select relrowsecurity from pg_class where oid='public.wms_files'::regclass) then raise exception 'RLS disabled';end if;
 if has_table_privilege('anon','public.wms_files','SELECT') or has_table_privilege('authenticated','public.wms_files','INSERT') or has_table_privilege('authenticated','public.wms_files','SELECT') then raise exception 'Public file access';end if;
 if not has_table_privilege('service_role','public.wms_files','SELECT,INSERT,DELETE') then raise exception 'Server privileges missing';end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='wms_file_bin_server_only' and permissive='RESTRICTIVE') then raise exception 'Storage server access rule missing';end if;
 if not exists(select 1 from storage.buckets where id='wms-file-bin' and public=false and file_size_limit=20971520) then raise exception 'Private bucket missing';end if;
end$$;`;
const inspect=process.argv.includes('--inspect');await sql('begin;'+migration+verify+(inspect?'rollback;':'commit;'));
if(!inspect){
 const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${project}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});if(!keysResponse.ok)throw Error('Storage test credentials unavailable');const keys=await keysResponse.json(),key=keys.find(item=>item.api_key?.startsWith('sb_secret_'))?.api_key;if(!key)throw Error('Storage test credentials unavailable');
 const base=`https://${project}.supabase.co/storage/v1`,object='smoke-'+crypto.randomUUID()+'/file',body='WMS file manager storage verification',auth={apikey:key,Authorization:`Bearer ${key}`};
 try{const upload=await fetch(base+'/object/wms-file-bin/'+object,{method:'POST',headers:{...auth,'Content-Type':'text/plain'},body,signal:AbortSignal.timeout(30000)});if(!upload.ok)throw Error('Private storage upload verification failed');
 const anonymous=await fetch(base+'/object/public/wms-file-bin/'+object,{signal:AbortSignal.timeout(30000)});if(anonymous.ok)throw Error('Anonymous file access must be denied');
 const sign=await fetch(base+'/object/sign/wms-file-bin/'+object,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60}),signal:AbortSignal.timeout(30000)}),signed=await sign.json();if(!sign.ok||!signed.signedURL)throw Error('Storage signing verification failed');const url=new URL(base+signed.signedURL);url.searchParams.set('download','wms-storage-check.txt');const download=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!download.ok||await download.text()!==body||!download.headers.get('content-disposition')?.includes('attachment'))throw Error('Storage download verification failed');
 }finally{const cleanup=await fetch(base+'/object/wms-file-bin',{method:'DELETE',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[object]}),signal:AbortSignal.timeout(30000)});if(!cleanup.ok)throw Error('Temporary storage verification object needs cleanup');}
}
const result=inspect?'Schema validated with rollback':'Private bucket, upload, signed download and cleanup verified';
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`result=${result}\n`);
console.log(result+'. No spreadsheet or inventory data modified.');
