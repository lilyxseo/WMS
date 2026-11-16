const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const qty=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const fmt=value=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:1}).format(qty(value));
export function dashboardChartData(insight={}){
 let inbound=0,outbound=0;
 const daily=(insight.daily||[]).map(day=>({date:String(day.date||''),day:day.day,inbound:inbound+=qty(day.inbound),outbound:outbound+=qty(day.outbound),movement:qty(day.movement)}));
 const comparison=(insight.activityComparison||[]).map(item=>({label:String(item.label||''),current:qty(item.current),previous:qty(item.previous)}));
 return {daily,comparison,movementAvailable:!!daily.length&&(insight.daily||[]).every(day=>Object.hasOwn(day,'movement'))};
}
const table=(headers,rows)=>`<details class="dashboard-chart-data"><summary>Lihat data chart</summary><div class="dashboard-chart-table"><table><thead><tr>${headers.map(label=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
const empty=message=>`<div class="dashboard-chart-empty" role="status">${esc(message)}</div>`;
function cumulativeChart(daily){
 if(!daily.some(day=>day.inbound||day.outbound))return empty('Belum ada arus masuk/keluar pada periode ini.');
 const max=Math.max(1,...daily.flatMap(day=>[day.inbound,day.outbound]));
 // Include day-zero baseline so a single-day period still shows a meaningful line.
 const points=[{inbound:0,outbound:0},...daily],x=index=>40+index/(points.length-1)*270,y=value=>150-value/max*120;
 const line=key=>points.map((point,index)=>`${x(index).toFixed(2)},${y(point[key]).toFixed(2)}`).join(' ');
 return `<div class="dashboard-chart-legend"><span class="in">Masuk</span><span class="out">Keluar</span></div><svg class="dashboard-cumulative" viewBox="0 0 330 180" role="img" aria-label="Arus kumulatif: masuk ${fmt(daily.at(-1).inbound)} pcs, keluar ${fmt(daily.at(-1).outbound)} pcs"><title>Akumulasi qty masuk dan keluar, bukan saldo stok</title>${[0,.5,1].map(ratio=>`<line x1="40" x2="310" y1="${y(max*ratio)}" y2="${y(max*ratio)}" class="chart-grid"/><text x="35" y="${y(max*ratio)+4}" text-anchor="end">${fmt(max*ratio)}</text>`).join('')}<polyline points="${line('inbound')}" class="chart-line in"/><polyline points="${line('outbound')}" class="chart-line out"/><text x="40" y="173">Awal bulan</text><text x="310" y="173" text-anchor="end">Tgl ${esc(daily.at(-1).day)}</text></svg>${table(['Tanggal','Kumulatif masuk (pcs)','Kumulatif keluar (pcs)'],daily.map(day=>[day.date,fmt(day.inbound),fmt(day.outbound)]))}`;
}
function movementChart(daily,available){
 if(!available)return empty('Data Movement harian belum tersedia.');
 const total=daily.reduce((sum,day)=>sum+day.movement,0),max=Math.max(1,...daily.map(day=>day.movement));
 if(!total)return empty('Belum ada Movement pada periode ini.');
 return `<div class="dashboard-movement-total"><strong>${fmt(total)} <small>pcs</small></strong><span>dipindahkan bulan ini</span></div><div class="dashboard-movement-bars">${daily.map((day,index)=>`<div class="dashboard-movement-day"><div class="dashboard-movement-track" tabindex="0" aria-label="${esc(day.date)}: ${fmt(day.movement)} pcs Movement" title="${esc(day.date)} · ${fmt(day.movement)} pcs"><span style="height:${day.movement/max*100}%"></span></div><small>${index===0||index===daily.length-1||(index+1)%5===0?esc(day.day):'&nbsp;'}</small></div>`).join('')}</div>${table(['Tanggal','Qty Movement (pcs)'],daily.map(day=>[day.date,fmt(day.movement)]))}`;
}
function comparisonChart(comparison){
 if(!comparison.length)return empty('Data pembanding belum tersedia.');
 if(!comparison.some(item=>item.current||item.previous))return empty('Belum ada aktivitas pada kedua periode.');
 const max=Math.max(1,...comparison.flatMap(item=>[item.current,item.previous]));
 return `<div class="dashboard-chart-legend"><span class="current">Bulan ini</span><span class="previous">Bulan lalu</span></div><div class="dashboard-comparisons">${comparison.map(item=>`<div class="dashboard-comparison"><strong>${esc(item.label)}</strong>${['current','previous'].map(key=>`<div class="dashboard-comparison-row" tabindex="0" aria-label="${esc(item.label)} ${key==='current'?'bulan ini':'bulan lalu'}: ${fmt(item[key])} pcs"><div class="dashboard-comparison-track"><span class="${key}" style="width:${item[key]/max*100}%"></span></div><span>${fmt(item[key])}</span></div>`).join('')}</div>`).join('')}</div>${table(['Aktivitas','Bulan ini (pcs)','Bulan lalu (pcs)'],comparison.map(item=>[item.label,fmt(item.current),fmt(item.previous)]))}`;
}
export function renderDashboardCharts(insight){
 const {daily,comparison,movementAvailable}=dashboardChartData(insight);
 return `<section class="dashboard-support" aria-label="Chart pendukung operasional"><div class="monthly-section-heading"><div><h5>Perspektif operasional</h5><p>${esc(insight.monthLabel||'Bulan berjalan')} · qty dalam pcs</p></div></div><div class="dashboard-support-grid"><article class="dashboard-support-card"><header><h5>Arus kumulatif</h5><p>Akumulasi sejak awal bulan, bukan saldo stok.</p></header>${cumulativeChart(daily)}</article><article class="dashboard-support-card"><header><h5>Movement harian</h5><p>Perpindahan internal, terpisah dari penerimaan.</p></header>${movementChart(daily,movementAvailable)}</article><article class="dashboard-support-card"><header><h5>Volume antarperiode</h5><p>${esc(insight.period?.comparisonLabel||'Periode bulan ini dan bulan lalu')}</p></header>${comparisonChart(comparison)}</article></div></section>`;
}
