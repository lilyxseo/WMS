import {readFile,appendFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;if(!project||!token)throw Error('Warning deployment configuration unavailable');
const base=`https://api.supabase.com/v1/projects/${project}`;
async function management(path,body){const res=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});if(!res.ok)throw Error(`Warning management operation failed (${res.status})`);const text=await res.text();return text.trim()?JSON.parse(text):[];}
const sql=query=>management('/database/query',{query}),literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const output=async result=>{if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`result=${result}\n`);console.log(result);};
if(process.argv.includes('--diagnose')){
 const rows=await sql(`select jsonb_build_object(
 'state',(select jsonb_build_object('initialized',initialized,'lifecycle',lifecycle_initialized,'lease',lease,'activeLease',lease>now()) from public.warning_notify_state where id),
 'tracking',(select jsonb_build_object('active',count(*) filter(where active),'resolved',count(*) filter(where not active),'lastChanged',max(changed_at),'lastSeen',max(last_seen)) from public.warning_notify_seen),
 'queue',(select coalesce(jsonb_agg(x),'[]') from (select event_type,status,count(*) as count,max(created_at) as latest,max(attempts) as attempts from public.warning_notify_outbox group by event_type,status order by event_type,status) x),
 'snapshot',(select jsonb_build_object('published',published_at,'attempt',last_attempt_at,'error',last_error,'total',jsonb_array_length(payload->'rows'),'partial',payload->'partial','unavailable',payload->'unavailableSources','verification',payload->'verification') from public.inventory_warning_snapshot where id),
 'sync',(select jsonb_agg(x) from (select source,status,last_success_at,locked_at from public.inventory_sync_status where source in ('kartu_stok','rpl','bulky','barang_masuk','barang_keluar')) x),
 'cron',(select jsonb_agg(x) from (select j.jobname,j.active,j.schedule,d.status,d.start_time,d.end_time from cron.job j left join lateral (select status,start_time,end_time from cron.job_run_details where jobid=j.jobid order by start_time desc limit 1) d on true where j.jobname in ('wms-warning-snapshot','wms-warning-notifications')) x)
 ) as health`);
 const health=rows[0]?.health||{};
 if(health.snapshot?.verification)health.snapshot.verification=health.snapshot.verification.map(item=>({source:item.source,ready:item.ready,stale:item.stale,readCode:item.readCode,reason:item.reason}));
 await output(JSON.stringify(health));exitDiagnostic();
}
function exitDiagnostic(){process.exit(0);}
const baseMigration=await readFile(new URL('../supabase/migrations/20261013030000_warning_notifications.sql',import.meta.url),'utf8'),migration=await readFile(new URL('../supabase/migrations/20261023000000_warning_notification_lifecycle.sql',import.meta.url),'utf8');
const recovery=await readFile(new URL('../supabase/migrations/20261026010000_warning_notification_recovery.sql',import.meta.url),'utf8');
const freshness=await readFile(new URL('../supabase/migrations/20261026020000_warning_resolution_freshness.sql',import.meta.url),'utf8');
const tests=`do $$declare owner uuid:=gen_random_uuid();contender uuid:=gen_random_uuid();finding jsonb;answer jsonb;event_id uuid;amount integer;begin
 delete from public.warning_notify_outbox;delete from public.warning_notify_seen;
 update public.warning_notify_state set initialized=false,lifecycle_initialized=false,run=null,lease=null where id;
 if not public.warning_notify_lock(owner) or public.warning_notify_lock(contender) then raise exception 'Lease ownership';end if;
 insert into public.warning_notify_seen(fingerprint,warning,active) values('historic-warning','{"sku":"OLD","issue":"Qty -1"}',true);
 finding:='[{"fingerprint":"test-warning","content_signature":"v1","warning":{"sku":"TEST","issue":"Qty -1"}}]'::jsonb;
 answer:=public.warning_notify_collect(owner,finding,array['620000000000'],false);if answer->>'new'<>'1' or answer->>'resolved'<>'0' then raise exception 'Historic resolution leaked';end if;
 perform public.warning_notify_collect(owner,finding,array['620000000000'],false);
 if (select count(*) from public.warning_notify_outbox)<>1 then raise exception 'Duplicate warning';end if;
 finding:='[{"fingerprint":"test-warning","content_signature":"v2","warning":{"sku":"TEST","issue":"Qty -2"}}]'::jsonb;
 answer:=public.warning_notify_collect(owner,finding,array['620000000000'],false);if answer->>'updated'<>'1' then raise exception 'Updated warning';end if;
 answer:=public.warning_notify_collect(owner,'[]',array['620000000000'],false);if answer->>'resolved'<>'1' then raise exception 'Resolved warning';end if;
 perform public.warning_notify_collect(owner,'[]',array['620000000000'],false);
 if (select count(*) from public.warning_notify_outbox)<>3 then raise exception 'Duplicate resolution';end if;
 select id into event_id from public.warning_notify_claim(owner) where event_type='resolved' limit 1;
 if event_id is null then raise exception 'Resolved event not claimed';end if;
 update public.warning_notify_outbox set status='sent' where status='sending' and id<>event_id;
 perform public.warning_notify_finish(owner,array[event_id],'failed');
 select count(*) into amount from public.warning_notify_claim(owner);if amount<>0 then raise exception 'Immediate failed retry';end if;
 update public.warning_notify_outbox set next_attempt_at=now()-interval '1 minute' where id=event_id;
 select count(*) into amount from public.warning_notify_claim(owner);if amount<>1 then raise exception 'Failed retry missing';end if;
 perform public.warning_notify_finish(owner,array[event_id],'uncertain');
 select count(*) into amount from public.warning_notify_claim(owner);if amount<>0 then raise exception 'Uncertain delivery retried';end if;
 answer:=public.warning_notify_collect(owner,finding,array['620000000000'],false);if answer->>'reopened'<>'1' then raise exception 'Reopened warning';end if;
 perform public.warning_notify_collect(owner,'[]',array['620000000000'],true);
 if not (select active from public.warning_notify_seen where fingerprint='test-warning') then raise exception 'Initialization erased active state';end if;
 update public.warning_notify_seen set last_seen=now()-interval '1 day' where fingerprint='test-warning';
 answer:=public.warning_notify_collect(owner,'[]',array['620000000000'],false);if answer->>'resolved'<>'0' then raise exception 'Stale baseline resolution leaked';end if;
 insert into public.warning_notify_outbox(fingerprint,recipient,warning,event_type,revision) values('historic-warning','620000000000','{}','resolved',100);
 select count(*) into amount from public.warning_notify_claim(owner);if amount<>0 then raise exception 'Historic queue claimed';end if;
 if exists(select 1 from public.warning_notify_outbox where fingerprint='historic-warning' and status='pending') then raise exception 'Historic queue not cancelled';end if;
 perform public.warning_notify_unlock(owner);
end$$;`;
if(process.argv.includes('--inspect')){await sql('begin;'+baseMigration+migration+recovery+freshness+tests+'rollback;');await output('Lifecycle, deduplication, retries and leases verified with rollback');}
else if(process.argv.includes('--configure')){
 await sql('begin;'+baseMigration+migration+recovery+freshness+'commit;');await sql('begin;'+tests+'rollback;');
 const secrets=await management('/secrets');if(!secrets.some(item=>item.name==='FONNTE_TOKEN'))throw Error('Fonnte token missing');
 const keys=await management('/api-keys?reveal=true'),key=keys.find(item=>item.api_key?.startsWith('sb_secret_'))?.api_key;if(!key)throw Error('Warning data key missing');
 const existing=await sql("select decrypted_secret from vault.decrypted_secrets where name='wms_warning_notify_secret' limit 1"),secret=existing[0]?.decrypted_secret||randomBytes(32).toString('hex');if(!existing.length)await sql(`select vault.create_secret(${literal(secret)},'wms_warning_notify_secret')`);
 const endpoint=`https://${project}.supabase.co/functions/v1/warning-whatsapp`;await sql(`do $$begin if not exists(select 1 from vault.secrets where name='wms_warning_notify_url') then perform vault.create_secret(${literal(endpoint)},'wms_warning_notify_url');end if;end$$`);
 const values=[{name:'WMS_WARNING_NOTIFY_SECRET',value:secret},{name:'WMS_WARNING_DATA_KEY',value:key}];if(!secrets.some(item=>item.name==='WMS_WARNING_RECIPIENTS')){const recipients=process.env.WMS_WARNING_RECIPIENTS;if(!/^62\d{8,13}(,62\d{8,13})*$/.test(recipients||''))throw Error('Warning recipients missing');values.push({name:'WMS_WARNING_RECIPIENTS',value:recipients});}await management('/secrets',values);await output('Private warning lifecycle configured; recipients preserved; no messages sent');
}else{
 const secret=(await sql("select decrypted_secret from vault.decrypted_secrets where name='wms_warning_notify_secret' limit 1"))[0]?.decrypted_secret;if(!secret)throw Error('Warning authentication missing');const endpoint=`https://${project}.supabase.co/functions/v1/warning-whatsapp`;
 if((await fetch(endpoint,{method:'POST'})).status!==401)throw Error('Anonymous notification access allowed');
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-WMS-Warning-Secret':secret},body:JSON.stringify({action:'check'}),signal:AbortSignal.timeout(30000)}),result=await response.json();if(!response.ok||result.delivery!=='not_sent')throw Error('Read-only notification check failed');
 await sql("do $$declare job bigint;begin select jobid into job from cron.job where jobname='wms-warning-notifications' limit 1;if job is null then perform cron.schedule('wms-warning-notifications','4-59/5 * * * *','select public.dispatch_warning_notifications()');else perform cron.alter_job(job,schedule:='4-59/5 * * * *',active:=true);end if;end$$");
 const jobs=await sql("select schedule,active from cron.job where jobname='wms-warning-notifications'");if(jobs.length!==1||jobs[0].schedule!=='4-59/5 * * * *'||!jobs[0].active)throw Error('Notification schedule not ready');
 await output(`Active every 5 minutes after server detection; snapshot ${result.ready?'ready':'awaiting complete refresh'}; deployment sent no messages`);
}
