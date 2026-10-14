import {normalizeTransactionDate} from './_transaction-read.js';
// The stock formula subtracts signed movement components. Check only a
// completely absent component (zero/missing row), never infer physical stock
// from raw ledger totals or flag a zero closing balance on its own.
const text=value=>String(value??'').trim();
export function normalizeMovementLocation(value){
 let raw=text(value);try{raw=decodeURIComponent(raw);}catch{}
 return raw.replace(/\u00A0/g,' ').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\s+/g,' ').trim().toUpperCase();
}
const key=(...parts)=>JSON.stringify(parts);
const zero=value=>Math.abs(value)<0.000001;
const kinds={'INTERNAL STOCK TRANSFER':{field:'internal_stock_transfer',label:'INTERNAL STOCK TRANSFER'},REPLENISHMENT:{field:'replenishment',label:'REPLENISHMENT'}};
export function movementImpactFindings(context,stock,{normalizeSku,number,businessDate,stockCheckedAt,now=new Date()}={}){
 const findings=[],groups=new Map(),net=new Map(),unknown=new Set(),seen=new Map(),stockByLocation=new Map(),activity=new Map();
 let skipped=0,checked=0;
 const cutoff=text(stockCheckedAt)?new Date(stockCheckedAt).getTime():NaN,nowMs=new Date(now).getTime();
 if(!context||!Array.isArray(context.movements)||!Array.isArray(context.activity)||!businessDate||!Number.isFinite(cutoff))return {findings,checked,skipped,ready:false};
 for(const row of stock){const k=key(normalizeSku(row.sku),normalizeMovementLocation(row.lokasi_bulky)),items=stockByLocation.get(k)||[];items.push(row);stockByLocation.set(k,items);}
 for(const item of context.activity){
  const k=key(normalizeSku(item.sku),normalizeMovementLocation(item.location)),prior=activity.get(k)||{last:'',unknown:false};
  const date=normalizeTransactionDate(item.last_date).value;
  prior.last=date&&date>prior.last?date:prior.last;prior.unknown=prior.unknown||!!item.unknown_date||!!(text(item.last_date)&&!date);activity.set(k,prior);
 }
 for(const row of context.movements){
  const sku=normalizeSku(row.sku),date=normalizeTransactionDate(row.tanggal).value,kind=Object.hasOwn(kinds,text(row.keterangan).toUpperCase())?kinds[text(row.keterangan).toUpperCase()]:null,qty=number(row.qty);
  if(!sku)continue;
  if(!date||date>businessDate||!kind||qty===null||qty<0){unknown.add(sku);skipped++;continue;}
  if(date.slice(0,4)!==businessDate.slice(0,4))continue;
  const from=normalizeMovementLocation(row.from_location),to=normalizeMovementLocation(row.to_location);
  const observed=text(row.synced_at)?new Date(row.synced_at).getTime():NaN;
  if(!from||!to||!Number.isFinite(observed)){unknown.add(sku);skipped++;continue;}
  seen.set(sku,Math.max(seen.get(sku)||0,observed));
  if(qty===0||from===to){
   findings.push({category:'MOVEMENT_NO_EFFECT',row,location:`${from} → ${to}`,issue:qty===0?'Qty movement 0; tidak ada stok yang dipindahkan.':'From dan To sama; movement tidak memindahkan lokasi.',evidence:`Barang Masuk baris ${row.source_row_number??'-'}: ${from} → ${to}, qty ${qty}, tanggal ${date}.`,recommendation:'Periksa input movement dan koreksi transaksi yang salah; jangan membuat transaksi pengganti sebelum mengecek riwayat.',confidence:'record'});continue;
  }
  const groupKey=key(sku,from,to,kind.field),group=groups.get(groupKey)||{sku,from,to,kind,qty:0,row,date};
  group.qty+=qty;
  if(date>group.date||(date===group.date&&Number(row.source_row_number)>Number(group.row.source_row_number))){group.row=row;group.date=date;}
  groups.set(groupKey,group);
  for(const [location,sign] of [[from,1],[to,-1]]){const k=key(sku,location,kind.field);net.set(k,(net.get(k)||0)+sign*qty);}
 }
 for(const group of groups.values()){
  // A successful stock read must follow the first/latest mirrored movement by
  // two minutes. Unchanged row synced_at is NOT a freshness indicator.
  if(unknown.has(group.sku)||cutoff<(seen.get(group.sku)||Infinity)+120000||nowMs<(seen.get(group.sku)||Infinity)+120000){skipped++;continue;}
  const missing=[],proof=[];
  for(const [side,location] of [['From',group.from],['To',group.to]]){
   const expected=net.get(key(group.sku,location,group.kind.field));
   if(!Number.isFinite(expected)||zero(expected))continue; // real reversals cancel
   const later=activity.get(key(group.sku,location));
   if(later?.unknown||(later?.last&&later.last>=group.date))continue; // date-only order is ambiguous
   const rows=stockByLocation.get(key(group.sku,location))||[];
   if(!rows.length){
    const other=stockByLocation.get(key(group.sku,side==='From'?group.to:group.from))||[];
    if(other.some(r=>number(r.stok_akhir)!==null&&number(r.stok_akhir)>0)){missing.push(`${side} ${location} belum memiliki baris SKU`);proof.push(`${side} ${location}: pasangan SKU/lokasi tidak ditemukan di Kartu Stok.`);}continue;
   }
   const values=rows.map(r=>number(r[group.kind.field])),closing=rows.map(r=>number(r.stok_akhir));
   if(values.some(v=>v===null)||closing.some(v=>v===null))continue;
   if(values.every(zero)){
    missing.push(`${side} ${location}`);
    proof.push(`${side} ${location}: ${group.kind.label} 0 (netto riwayat ${expected}); saldo ${closing.reduce((a,b)=>a+b,0)}; baris Kartu Stok ${rows.map(r=>r.source_row_number??'-').join(', ')}.`);
   }
  }
  checked++;
  if(missing.length)findings.push({category:'MOVEMENT_NOT_REFLECTED',row:group.row,location:`${group.from} → ${group.to}`,issue:`Movement ${group.qty} pcs belum tercermin pada ${missing.join(' dan ')}.`,evidence:`Barang Masuk baris ${group.row.source_row_number??'-'}, tanggal ${group.date}, ${group.kind.label}. ${proof.join(' ')}`,recommendation:'Periksa formula/rentang mutasi dan kecocokan SKU, From, To di Kartu Stok. Verifikasi periode saldo sebelum koreksi; jangan input movement ulang.',confidence:'review'});
 }
 return {findings,checked,skipped,ready:true};
}
