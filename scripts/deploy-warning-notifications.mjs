import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
process.on('unhandledRejection',error=>{console.error('::error::'+error.message);process.exit(1);});
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
const base=`https://api.supabase.com/v1/projects/${project}`;
async function management(path,body){
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`Management operation failed: HTTP ${response.status}`);return response.json();
}
const sql=query=>management('/database/query',{query});
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
if(!project||!token)throw new Error('Deployment configuration unavailable');
const endpoint=`https://${project}.supabase.co/functions/v1/warning-whatsapp`;
if(process.argv.includes('--configure')){
 const recipients=process.env.WMS_WARNING_RECIPIENTS;
 if(!/^62\d{8,13}(,62\d{8,13})*$/.test(recipients||''))throw new Error('Notification recipients unavailable');
 await sql(await readFile(new URL('../supabase/migrations/20261013030000_warning_notifications.sql',import.meta.url),'utf8'));
 // Exercise persistent deduplication and lease ownership in a rolled-back transaction.
 await sql(`begin;
 do $test$
 declare owner uuid:=gen_random_uuid(); contender uuid:=gen_random_uuid(); finding jsonb; claimed integer;
 begin
  perform 1 from public.warning_notify_state where id for update;
  update public.warning_notify_state set initialized=false,run=null,lease=null where id;
  if not public.warning_notify_lock(owner) then raise exception 'Cannot acquire test lease';end if;
  if public.warning_notify_lock(contender) then raise exception 'Overlapping run accepted';end if;
  finding:=jsonb_build_array(jsonb_build_object('fingerprint','deployment-test-'||owner,'warning','{}'::jsonb));
  perform public.warning_notify_collect(owner,finding,array['620000000000'],true);
  if exists(select 1 from public.warning_notify_outbox where fingerprint='deployment-test-'||owner) then raise exception 'Baseline enqueued messages';end if;
  finding:=jsonb_build_array(jsonb_build_object('fingerprint','deployment-new-'||owner,'warning','{}'::jsonb));
  perform public.warning_notify_collect(owner,finding,array['620000000000'],true);
  if exists(select 1 from public.warning_notify_seen where fingerprint='deployment-new-'||owner) then raise exception 'Redeploy swallowed a new finding';end if;
  perform public.warning_notify_collect(owner,finding,array['620000000000'],false);
  perform public.warning_notify_collect(owner,finding,array['620000000000'],false);
  select count(*) into claimed from public.warning_notify_outbox where fingerprint='deployment-new-'||owner;
  if claimed<>1 then raise exception 'Persistent deduplication failed';end if;
  perform public.warning_notify_unlock(owner);
 end $test$;
 rollback;`);
 console.log('Database baseline, persistent deduplication and overlapping-run checks passed; test writes rolled back.');
 const secrets=await management('/secrets');if(!secrets.some(s=>s.name==='FONNTE_TOKEN'))throw new Error('Fonnte configuration unavailable');
 const keys=await management('/api-keys?reveal=true');const key=keys.find(k=>k.api_key?.startsWith('sb_secret_'))?.api_key;
 if(!key)throw new Error('Server data key unavailable');
 const existing=await sql("select decrypted_secret from vault.decrypted_secrets where name='wms_warning_notify_secret' limit 1");
 const secret=existing[0]?.decrypted_secret||randomBytes(32).toString('hex');
 if(!existing.length)await sql(`select vault.create_secret(${literal(secret)},'wms_warning_notify_secret')`);
 await sql(`do $$begin if not exists(select 1 from vault.secrets where name='wms_warning_notify_url') then perform vault.create_secret(${literal(endpoint)},'wms_warning_notify_url');end if;end$$`);
 await management('/secrets',[{name:'WMS_WARNING_NOTIFY_SECRET',value:secret},{name:'WMS_WARNING_DATA_KEY',value:key},{name:'WMS_WARNING_RECIPIENTS',value:recipients}]);
 console.log('Warning notification schema and private configuration ready. No messages sent.');
}else{
 const existing=await sql("select decrypted_secret from vault.decrypted_secrets where name='wms_warning_notify_secret' limit 1");
 const secret=existing[0]?.decrypted_secret;if(!secret)throw new Error('Notification auth unavailable');
 const denied=await fetch(endpoint,{method:'POST'});if(denied.status!==401)throw new Error('Anonymous access must be denied');
 for(const action of ['check','initialize']){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-WMS-Warning-Secret':secret},body:JSON.stringify({action}),signal:AbortSignal.timeout(120000)});
  const result=await response.json();
  if(!response.ok||(action==='check'&&!result.ready)||(action==='initialize'&&result.status!=='initialized'))throw new Error(`Notification validation failed (${action})`);
  console.log(`Warning ${action} verified; ${result.total??'baseline preserved'}; no messages sent.`);
 }
 await sql("do $$begin if not exists(select 1 from cron.job where jobname='wms-warning-notifications') then perform cron.schedule('wms-warning-notifications','*/5 * * * *','select public.dispatch_warning_notifications()');end if;end$$");
 const jobs=await sql("select schedule,active from cron.job where jobname='wms-warning-notifications'");
 if(jobs.length!==1||jobs[0].schedule!=='*/5 * * * *'||!jobs[0].active)throw new Error('Warning schedule not active');
 console.log('Automatic warning checks active every five minutes. Existing bot and summary schedule preserved.');
}
