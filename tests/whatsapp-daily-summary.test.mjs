import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDate, summaryDate, getDailySummary, formatDailySummary, handleDailySummary } from '../supabase/functions/whatsapp-fonnte/daily-summary.js';
import { handleScheduledSummary } from '../supabase/functions/whatsapp-fonnte/summary-scheduler.js';
import { handleFonnteWebhook } from '../supabase/functions/whatsapp-fonnte/handler.js';
import { schedulerSql, setupDailySummary } from '../scripts/setup-whatsapp-summary.mjs';

const config={url:'https://db.test',key:'test'};
const now=new Date('2026-10-11T08:45:00Z');
function reads(incoming=[],outgoing=[]) {
 const urls=[];
 const fetchFn=async url=>{
  urls.push(url);const q=new URL(url).searchParams;
  assert.equal(q.get('tanggal'),'eq.2026-10-11');
  const rows=url.includes('inventory_barang_masuk')?incoming:outgoing;
  return Response.json(rows.slice(Number(q.get('offset')),Number(q.get('offset'))+Number(q.get('limit'))));
 };
 return {fetchFn,urls};
}

test('summary dates respect Jakarta rollover, yesterday and valid historical date, rejecting future and malformed dates',()=>{
 const nextDay=new Date('2026-10-11T18:01:00Z');assert.equal(businessDate(nextDay),'2026-10-12');
 assert.equal(summaryDate('ringkasan',nextDay),'2026-10-12');assert.equal(summaryDate('ringkasan kemarin',nextDay),'2026-10-11');
 assert.equal(summaryDate('ringkasan 2026-10-10',nextDay),'2026-10-10');assert.equal(summaryDate('masuk',now),undefined);
 for(const command of ['ringkasan 2026-02-30','ringkasan 2027-01-01','ringkasan abc'])assert.throws(()=>summaryDate(command,now),/Gunakan ringkasan/);
});

test('daily summary separates movement from incoming and outgoing and counts SKU distinctly with top PIC',async()=>{
 const f=reads([{sku:'001',qty:5,status:'Barang Masuk',pic:'ABI'},{sku:'001',qty:3,status:'Barang Masuk',pic:'ABI'},{sku:'002',qty:2,status:'Movement',pic:'ENGGAL'},{sku:'003',qty:4,keterangan:'INTERNAL STOCK TRANSFER',pic:'ABI'}],[{sku:'001',qty:6,status:'Barang Keluar',pic:'EPRIL'},{sku:'002',qty:2,status:'Movement'}]);
 const result=await getDailySummary(config,'2026-10-11',f.fetchFn);
 assert.equal(result.incoming.qty,8);assert.equal(result.incoming.transactions,2);assert.equal(result.incoming.skus.size,1);
 assert.equal(result.outgoing.qty,6);assert.equal(result.outgoing.transactions,1);assert.equal(result.movement.qty,6);assert.equal(result.movement.transactions,2);
 const message=formatDailySummary(result,now);assert.match(message,/ABI \(2\)/);assert.match(message,/Movement dihitung terpisah/);assert.match(message,/15.45/);assert.doesNotMatch(message,/NaN|Infinity/);
});

test('summary scans over 5000 matching daily transactions and never presents partial data after a failed batch',async()=>{
 const f=reads(Array.from({length:6001},()=>({sku:'001',qty:1,status:'Barang Masuk'})));
 const result=await getDailySummary(config,'2026-10-11',f.fetchFn);assert.equal(result.incoming.transactions,6001);assert.equal(result.incoming.qty,6001);assert.equal(f.urls.filter(url=>url.includes('barang_masuk')).length,7);
 await assert.rejects(getDailySummary(config,'2026-10-11',async url=>new URL(url).searchParams.get('offset')==='1000'?Response.json({}, {status:500}):Response.json(Array.from({length:1000},()=>({sku:'001',qty:1})))),/read failed/);
 assert.match(await handleDailySummary('ringkasan',{},config,async()=>Response.json({}, {status:500}),now),/gagal dibaca/);
});

test('summary shows empty-day result and flags invalid qty instead of fabricating totals',async()=>{
 const empty=await getDailySummary(config,'2026-10-11',reads().fetchFn);assert.match(formatDailySummary(empty,now),/Belum ada transaksi/);
 const invalid=await getDailySummary(config,'2026-10-11',reads([{sku:'001',qty:null},{sku:'002',qty:'invalid'},{sku:'003',qty:'1,200'}]).fetchFn);
 assert.equal(invalid.incoming.qty,1200);assert.equal(invalid.incoming.invalidQty,2);assert.match(formatDailySummary(invalid,now),/2 transaksi memiliki qty/);
});

function scheduledFixture({rejectSend=false,failRead=false,failClaim=false}={}) {
 const env={WHATSAPP_SUMMARY_SCHEDULER_SECRET:'scheduler',FONNTE_TOKEN:'token'},claims=new Map(),sends=[];
 const request=()=>new Request('https://bot.test',{method:'POST',headers:{Authorization:'Bearer scheduler'},body:JSON.stringify({recipients:['6281234567890','6281234567890']})});
 const fetchFn=async(url,init={})=>{
  if(url.includes('/inventory_barang_'))return failRead?Response.json({}, {status:500}):Response.json([{sku:'001',qty:1,status:'Barang Masuk'}]);
  if(url.includes('/whatsapp_daily_deliveries')) {
   if(failClaim)return Response.json({}, {status:500});
   const body=JSON.parse(init.body);
   if(init.method==='POST') {const key=`${body.business_date}:${body.recipient}`;if(claims.has(key))return Response.json([]);claims.set(key,body);return Response.json([body]);}
   const q=new URL(url).searchParams,key=`${q.get('business_date').slice(3)}:${q.get('recipient').slice(3)}`;claims.set(key,{...claims.get(key),...body});return new Response(null,{status:204});
  }
  if(url==='https://api.fonnte.com/send'){sends.push(init.body);if(rejectSend)throw new Error('Uncertain response');return Response.json({status:true});}
  throw new Error('Unexpected scheduler request');
 };
 return {env,claims,sends,fetchFn,request};
}

test('scheduled summary requires separate authentication and sends once per date and chosen recipient under concurrent calls',async()=>{
 const f=scheduledFixture();
 assert.equal((await handleScheduledSummary(new Request('https://bot.test',{method:'POST',body:'{}'}),f.env,config,()=>{throw new Error('no database access');},now)).status,401);
 const results=await Promise.all([handleScheduledSummary(f.request(),f.env,config,f.fetchFn,now),handleScheduledSummary(f.request(),f.env,config,f.fetchFn,now)]);
 assert.ok(results.every(response=>response.status===200));assert.equal(f.sends.length,1);assert.equal(f.sends[0].get('target'),'6281234567890');assert.equal([...f.claims.values()][0].status,'sent');
});

test('scheduled summary does not send on database/claim failure and does not retry uncertain delivery',async()=>{
 for(const options of [{failRead:true},{failClaim:true}]){const f=scheduledFixture(options);assert.ok((await handleScheduledSummary(f.request(),f.env,config,f.fetchFn,now)).status>=500);assert.equal(f.sends.length,0);}
 const f=scheduledFixture({rejectSend:true});assert.equal((await handleScheduledSummary(f.request(),f.env,config,f.fetchFn,now)).status,502);
 assert.equal((await handleScheduledSummary(f.request(),f.env,config,f.fetchFn,now)).status,200);assert.equal(f.sends.length,1);assert.equal([...f.claims.values()][0].status,'uncertain');
});

test('webhook scheduled route cannot use public webhook secret to bypass scheduler authentication',async()=>{
 const env={SUPABASE_URL:config.url,WMS_SUPABASE_SECRET_KEY:config.key,FONNTE_WEBHOOK_SECRET:'public-webhook',WHATSAPP_SUMMARY_SCHEDULER_SECRET:'scheduler'};
 const request=new Request('https://bot.test?secret=public-webhook',{method:'POST',headers:{'X-WMS-Action':'daily-summary'},body:'{}'});
 assert.equal((await handleFonnteWebhook({request,env},()=>{throw new Error('must not fetch');})).status,401);
});

test('scheduler deployment installs deduplication and secrets, targets only configured numbers and schedules 15:45 WIB',async()=>{
 const calls=[];
 await setupDailySummary({SUPABASE_ACCESS_TOKEN:'management-token',SUPABASE_PROJECT_REF:'projectref',WHATSAPP_DAILY_SUMMARY_NUMBERS:'6281234567890'},async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json({});});
 assert.equal(calls.length,3);assert.match(calls[0].body.query,/whatsapp_daily_deliveries/);assert.equal(calls[1].body[0].name,'WHATSAPP_SUMMARY_SCHEDULER_SECRET');
 assert.match(calls[2].body.query,/'45 8 \* \* \*'/);assert.match(calls[2].body.query,/vault.decrypted_secrets/);assert.match(calls[2].body.query,/6281234567890/);assert.doesNotMatch(calls[2].body.query,/628996628761/);
 const sql=schedulerSql('projectref',['6281234567890'],'safe');assert.match(sql,/cron.unschedule/);
});
