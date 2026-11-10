import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyInsight,monthlyPeriod,monthlyChange} from '../assets/js/utils/monthly-insight.js';
import {buildAutoInsight} from '../assets/js/utils/insight-helper.js';
import {renderMonthlyInsight} from '../assets/js/monthly-insight-view.js';
import {handleDashboardMonthlyInsightRequest} from '../functions/api/dashboard-monthly-insight.js';
const now=new Date('2026-11-10T02:00:00Z');
const row=(date,sku,qty,status='Barang Keluar',other={})=>({tanggal:date,sku,qty,status,nama_barang:'Product '+sku,keterangan:status==='Movement'?'INTERNAL STOCK TRANSFER':status==='Barang Masuk'?'RECEIPT':'PENGELUARAN',...other});
test('month-to-date uses warehouse timezone, year rollover and previous month day clamp',()=>{
 assert.equal(monthlyPeriod(new Date('2026-10-31T18:00:00Z')).current,'2026-11');
 assert.equal(monthlyPeriod(new Date('2026-01-01T00:00:00Z')).previousStart,'2025-12-01');
 assert.equal(monthlyPeriod(new Date('2024-03-31T02:00:00Z')).previousEnd,'2024-02-29');
});
test('comparison uses same elapsed month window and excludes future, non-positive and invalid rows',()=>{
 const result=buildMonthlyInsight({now,outbound:[row('2026-11-01','0012',20),row('2026-10-01','0012',10),row('2026-10-11','0012',10000),row('2026-11-11','0012',1000),row('2026-11-01','0012',-1),row('2026-11-01','0012',0),row('invalid','0012',2)]});
 assert.equal(result.aggregates.outbound.qty,20);assert.equal(result.aggregates.outbound.previousQty,10);assert.equal(result.insight.totals[1].change.percent,100);assert.equal(result.insight.ranking[0].change.percent,100);assert.equal(result.insight.quality.invalidRows,1);assert.equal(result.insight.quality.nonPositiveRows,2);
});
test('ranking compares each SKU rather than total outgoing and retains leading zeros',()=>{
 const result=buildMonthlyInsight({now,outbound:[row('2026-11-01','0012',20),row('2026-11-01','12',10),row('2026-10-01','0012',10),row('2026-10-01','12',100)]});
 assert.equal(result.insight.ranking[0].sku,'0012');assert.equal(result.insight.ranking[0].change.percent,100);assert.ok(result.insight.totals[1].change.percent<0);assert.equal(result.insight.ranking[0].share,66.7);assert.equal(result.insight.totals[3].value,2);
});
test('movement is separate from receipts and no percentage is invented for a zero baseline',()=>{
 const result=buildMonthlyInsight({now,inbound:[row('2026-11-01','A',10,'Barang Masuk'),row('2026-11-01','A',100,'Movement')]});
 assert.equal(result.aggregates.inbound.qty,10);assert.equal(result.aggregates.movement.qty,100);assert.equal(result.insight.totals[0].change.percent,null);assert.equal(result.insight.daily[0].inbound,10);assert.equal(monthlyChange(100,0).label,'Belum ada pembanding');
});
test('empty period is explicit and does not claim healthy stock or sales',()=>{
 const result=buildMonthlyInsight({now});assert.equal(result.insight.noActivity,true);assert.equal(result.insight.important,null);assert.equal(result.insight.ranking.length,0);assert.match(renderMonthlyInsight(result.insight),/Belum ada aktivitas/);assert.doesNotMatch(renderMonthlyInsight(result.insight),/terlaris|stok aman/i);
});
test('legacy hydrated dashboard and server use identical calculations without random selection',()=>{
 const data={'Barang Masuk':[row('11/1/2026','A',10,'Barang Masuk')],'Barang Keluar':[row('11/2/2026','A',7)]};
 assert.deepEqual(buildAutoInsight(data,{now}),buildMonthlyInsight({inbound:data['Barang Masuk'],outbound:data['Barang Keluar'],now}).insight);assert.deepEqual(buildAutoInsight(data,{now}),buildAutoInsight(data,{now}));
});
test('renderer escapes source content and only links to safe application routes',()=>{
 const insight=buildMonthlyInsight({now,outbound:[row('2026-11-01','A',3,'Barang Keluar',{nama_barang:'<img src=x onerror=alert(1)>'})]}).insight;
 insight.insights[0].route='javascript:alert(1)';const html=renderMonthlyInsight(insight);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|href="javascript:/);assert.match(html,/href="\/search"/);assert.match(html,/Selisih arus bukan saldo stok/);
});
test('API pages bounded period reads and returns no-store analytics with matching period details',async()=>{
 const original=globalThis.fetch,urls=[];globalThis.fetch=async url=>{const u=new URL(url);urls.push(u);const offset=Number(u.searchParams.get('offset'));return Response.json(offset===0?Array.from({length:1000},()=>row('2026-11-01','A',1,u.pathname.includes('barang_masuk')?'Barang Masuk':'Barang Keluar')):[row('2026-11-02','A',1,u.pathname.includes('barang_masuk')?'Barang Masuk':'Barang Keluar')]);};
 try{const response=await handleDashboardMonthlyInsightRequest({request:new Request('https://wms.test/api/dashboard-monthly-insight'),env:{SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'sb_secret_test'}},{authorize:async()=>true,now});const data=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(data.aggregates.inbound.qty,1001);assert.equal(urls.length,4);for(const url of urls){assert.deepEqual(url.searchParams.getAll('tanggal'),['gte.2026-10-01','lte.2026-11-10']);assert.ok(url.searchParams.get('select').includes('status'));}assert.equal(data.insight.version,2);}finally{globalThis.fetch=original;}
});
test('API auth and unavailable data never become successful empty analytics',async()=>{
 assert.equal((await handleDashboardMonthlyInsightRequest({request:new Request('https://wms.test/api/x'),env:{}},{authorize:async()=>false})).status,401);
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({message:'Unavailable'},{status:503});try{const response=await handleDashboardMonthlyInsightRequest({request:new Request('https://wms.test/api/x'),env:{SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'sb_secret_test'}},{authorize:async()=>true,now});assert.equal(response.status,502);}finally{globalThis.fetch=original;}
});
