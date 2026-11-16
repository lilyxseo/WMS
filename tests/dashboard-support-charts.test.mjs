import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyInsight} from '../assets/js/utils/monthly-insight.js';
import {dashboardChartData,renderDashboardCharts} from '../assets/js/dashboard-charts.js';
import {renderMonthlyInsight} from '../assets/js/monthly-insight-view.js';
const now=new Date('2026-11-16T02:00:00Z');
const row=(tanggal,qty,status,sku='0012')=>({tanggal,qty,status,sku,nama_barang:'Product',keterangan:status==='Movement'?'INTERNAL STOCK TRANSFER':status==='Barang Masuk'?'RECEIPT':'PENGELUARAN'});
test('support charts keep internal Movement separate from cumulative receipts and compare matching periods',()=>{
 const {insight}=buildMonthlyInsight({now,inbound:[row('2026-11-01',10,'Barang Masuk'),row('2026-11-02',4,'Barang Masuk'),row('2026-11-02',6,'Movement'),row('2026-10-02',3,'Movement'),row('2026-10-17',999,'Movement'),row('2026-11-17',999,'Movement'),row('2026-11-02',-1,'Movement')],outbound:[row('2026-11-02',8,'Barang Keluar')]});
 const model=dashboardChartData(insight);assert.equal(model.daily[0].inbound,10);assert.equal(model.daily[1].inbound,14);assert.equal(model.daily.at(-1).inbound,14);assert.equal(model.daily.at(-1).outbound,8);assert.equal(model.daily[1].movement,6);assert.deepEqual(model.comparison.map(item=>[item.current,item.previous]),[[14,0],[8,0],[6,3]]);assert.equal(model.movementAvailable,true);
 const html=renderMonthlyInsight(insight);for(const title of ['Arus kumulatif','Movement harian','Volume antarperiode'])assert.ok(html.includes(title));assert.match(html,/bukan saldo stok/);
});
test('no activity and missing old payload fields show explicit empty/unavailable states instead of invented data',()=>{
 const empty=renderDashboardCharts(buildMonthlyInsight({now}).insight);assert.match(empty,/Belum ada Movement/);assert.match(empty,/Belum ada aktivitas pada kedua periode/);assert.doesNotMatch(empty,/NaN|Infinity/);
 const old=renderDashboardCharts({daily:[{date:'2026-11-01',day:1,inbound:1,outbound:0}]});assert.match(old,/Data Movement harian belum tersedia/);assert.match(old,/Data pembanding belum tersedia/);
});
test('one-day periods have finite chart coordinates and data tables expose exact values',()=>{
 const insight=buildMonthlyInsight({now:new Date('2026-11-01T01:00:00Z'),inbound:[row('2026-11-01',100,'Barang Masuk'),row('2026-11-01',25,'Movement')]}).insight;
 const html=renderDashboardCharts(insight);assert.doesNotMatch(html,/NaN|Infinity/);assert.match(html,/Kumulatif masuk \(pcs\)/);assert.match(html,/Qty Movement \(pcs\)/);assert.match(html,/25/);assert.match(html,/role="img"/);assert.match(html,/Lihat data chart/);
});
test('source labels and dates are escaped in chart markup and accessibility attributes',()=>{
 const html=renderDashboardCharts({monthLabel:'<img src=x>',period:{comparisonLabel:'<script>x</script>'},daily:[{date:'"><img src=x>',day:'<b>',inbound:2,outbound:1,movement:1}],activityComparison:[{label:'<svg onload=alert(1)>',current:2,previous:1}]});assert.doesNotMatch(html,/<img|<script|<svg onload/);assert.match(html,/&lt;img/);
});
