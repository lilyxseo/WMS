const text=value=>String(value??'').trim();
const field=(row,...keys)=>{if(Array.isArray(row)){const map={tanggal:0,from:1,to:2,sku:3,nama_barang:4,qty:5,status:6,keterangan:8};for(const key of keys)if(map[key]!==undefined)return row[map[key]];return '';}for(const key of keys)if(row?.[key]!==undefined)return row[key];return '';};
const number=value=>{if(typeof value==='number')return Number.isFinite(value)?value:null;const raw=text(value);if(!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw))return null;return Number(raw.replaceAll(',',''));};
const fmt=value=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:1}).format(value);
function dateKey(value){const raw=text(value),iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw),slash=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);if(!iso&&!slash)return '';const [year,month,day]=iso?iso.slice(1).map(Number):[Number(slash[3]),Number(slash[1]),Number(slash[2])];const d=new Date(Date.UTC(year,month-1,day));return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?d.toISOString().slice(0,10):'';}
export function monthlyPeriod(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=type=>parts.find(part=>part.type===type).value;
 const end=`${get('year')}-${get('month')}-${get('day')}`,current=end.slice(0,7),previousDate=new Date(Date.UTC(Number(get('year')),Number(get('month'))-2,1)),previous=previousDate.toISOString().slice(0,7),days=Number(get('day')),previousDays=new Date(Date.UTC(Number(get('year')),Number(get('month'))-1,0)).getUTCDate();
 const comparisonDays=Math.min(days,previousDays),comparisonEnd=`${previous}-${String(comparisonDays).padStart(2,'0')}`;
 const label=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',month:'long',year:'numeric'}).format(now);
 return {current,previous,start:current+'-01',end,previousStart:previous+'-01',previousEnd:comparisonEnd,days,comparisonDays,label,comparisonLabel:`1–${days} ${label} dibandingkan 1–${comparisonDays} ${new Intl.DateTimeFormat('id-ID',{timeZone:'UTC',month:'long',year:'numeric'}).format(previousDate)}`};
}
export function monthlyChange(current,previous){return {current,previous,delta:current-previous,percent:previous>0?Math.round((current-previous)/previous*1000)/10:null,label:previous>0?`${current===previous?'Tetap':current>previous?'Naik':'Turun'} ${fmt(Math.abs((current-previous)/previous*100))}%`:current>0?'Belum ada pembanding':'Belum ada aktivitas'};}
export function buildMonthlyInsight({inbound=[],outbound=[],now=new Date()}={}){
 const period=monthlyPeriod(now),quality={invalidRows:0,nonPositiveRows:0},all=[];
 for(const [direction,rows]of [['in',inbound],['out',outbound]])for(const row of rows){
  const date=dateKey(field(row,'tanggal','date')),qty=number(field(row,'qty','quantity')),sku=text(field(row,'sku')).toUpperCase();
  if(!date||qty===null||!sku){quality.invalidRows++;continue;}if(qty<=0){quality.nonPositiveRows++;continue;}
  if(date>period.end||date<period.previousStart)continue;
  const status=text(field(row,'status')).toLowerCase(),reason=text(field(row,'keterangan')).toLowerCase();
  const internal=status==='movement'||reason==='internal stock transfer';
  const included=direction==='in'?(internal||status==='barang masuk'||reason==='receipt'):(!internal&&(reason==='pengeluaran'||status==='barang keluar'));
  if(!included)continue;
  all.push({date,qty,sku,name:text(field(row,'nama_barang','namaBarang','nama barang','nama')),from:text(field(row,'from_location','from')),to:text(field(row,'to_location','to')),kind:internal?'movement':direction});
 }
 const current=all.filter(row=>row.date>=period.start),previous=all.filter(row=>row.date>=period.previousStart&&row.date<=period.previousEnd),select=(rows,kind)=>rows.filter(row=>row.kind===kind),sum=rows=>rows.reduce((n,row)=>n+row.qty,0);
 const curIn=select(current,'in'),curOut=select(current,'out'),curMove=select(current,'movement'),prevIn=select(previous,'in'),prevOut=select(previous,'out');
 const inQty=sum(curIn),outQty=sum(curOut),net=inQty-outQty,activeSku=new Set([...curIn,...curOut].map(row=>row.sku)).size;
 const previousSku=new Map();for(const row of prevOut)previousSku.set(row.sku,(previousSku.get(row.sku)||0)+row.qty);
 const ranked=new Map();for(const row of curOut){const item=ranked.get(row.sku)||{sku:row.sku,name:row.name,qty:0,rows:0};item.qty+=row.qty;item.rows++;if(!item.name)item.name=row.name;ranked.set(row.sku,item);}
 const ranking=[...ranked.values()].sort((a,b)=>b.qty-a.qty||a.sku.localeCompare(b.sku)).slice(0,5).map(item=>({...item,share:outQty?Math.round(item.qty/outQty*1000)/10:0,change:monthlyChange(item.qty,previousSku.get(item.sku)||0)}));
 const daily=Array.from({length:period.days},(_,i)=>({date:period.current+'-'+String(i+1).padStart(2,'0'),day:i+1,inbound:0,outbound:0,rows:0}));for(const row of [...curIn,...curOut]){const item=daily[Number(row.date.slice(-2))-1];item[row.kind==='in'?'inbound':'outbound']+=row.qty;item.rows++;}
 const peak=[...daily].sort((a,b)=>(b.inbound+b.outbound)-(a.inbound+a.outbound)||a.date.localeCompare(b.date))[0];
 const totals=[{key:'inbound',label:'Qty masuk',value:inQty,unit:'pcs',detail:`${curIn.length} baris penerimaan`,change:monthlyChange(inQty,sum(prevIn))},{key:'outbound',label:'Qty keluar',value:outQty,unit:'pcs',detail:`${curOut.length} baris pengeluaran`,change:monthlyChange(outQty,sum(prevOut))},{key:'net',label:'Selisih arus',value:net,unit:'pcs',detail:'Qty masuk − qty keluar'},{key:'active',label:'SKU bertransaksi',value:activeSku,unit:'SKU',detail:'SKU unik masuk atau keluar'}];
 const findings=[];
 if(inQty||outQty)findings.push({key:'flow',tone:net<0?'warn':'info',title:net<0?'Pengeluaran melebihi penerimaan':net>0?'Penerimaan melebihi pengeluaran':'Arus masuk dan keluar seimbang',text:net?`Selisih ${fmt(Math.abs(net))} pcs pada periode ini. ${net<0?'Periksa ketersediaan barang dan rencana penerimaan berikutnya.':'Cocokkan penerimaan dengan rencana distribusi.'}`:'Cocokkan saldo lokasi dengan stok fisik; keseimbangan arus tidak membuktikan akurasi stok.',route:net<0?'/barang-keluar':'/barang-masuk',action:'Periksa transaksi'});
 if(ranking[0])findings.push({key:'concentration',tone:ranking[0].share>=50?'warn':'info',title:ranking[0].share>=50?'Pengeluaran terkonsentrasi pada satu SKU':'SKU dengan pengeluaran tertinggi',text:`${ranking[0].sku} menyumbang ${fmt(ranking[0].share)}% pengeluaran (${fmt(ranking[0].qty)} pcs). Prioritaskan pengecekan kesiapan stok SKU ini.`,route:'/sku/'+encodeURIComponent(ranking[0].sku),action:'Lihat Detail SKU'});
 if(peak?.rows)findings.push({key:'peak',tone:'info',title:'Hari dengan arus barang tertinggi',text:`Tanggal ${Number(peak.date.slice(-2))}: ${fmt(peak.inbound+peak.outbound)} pcs dari ${peak.rows} baris transaksi. Gunakan sebagai bahan evaluasi kapasitas penerimaan dan pengeluaran.`,route:peak.inbound>=peak.outbound?'/barang-masuk':'/barang-keluar',action:'Lihat transaksi'});
 if(curMove.length)findings.push({key:'movement',tone:'info',title:'Movement internal dihitung terpisah',text:`${curMove.length} baris movement, ${fmt(sum(curMove))} pcs. Tidak ditambahkan ke Qty masuk agar perpindahan internal tidak dianggap penerimaan baru.`,route:'/movement',action:'Lihat Movement'});
 const generatedAt=now.toISOString();
 return {aggregates:{current:period.current,previous:period.previous,period,inbound:{qty:inQty,rows:curIn.length,previousQty:sum(prevIn)},outbound:{qty:outQty,rows:curOut.length,previousQty:sum(prevOut)},movement:{qty:sum(curMove),rows:curMove.length},quality},insight:{version:2,empty:false,title:'Auto Insight Bulanan',subtitle:'Arus barang dan prioritas operasional',monthLabel:period.label,period,generatedAt,totals,ranking,daily,insights:findings,important:findings[0]||null,noActivity:!current.length,quality}};
}
