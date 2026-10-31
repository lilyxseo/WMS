import {attachNegativeStockTraces} from './_negative-stock-trace.js';
import {businessDateKey} from './_inventory-analytics.js';
import {normalizeTransactionDate} from './_transaction-read.js';
import {loadWarningData} from './_warning-data.js';
import {movementImpactFindings} from './_movement-warning.js';
export const WARNING_CATEGORIES=Object.freeze({
 INVALID_OUTBOUND_FROM:'Lokasi From Tidak Valid',NEGATIVE_STOCK:'Saldo Negatif',STOCK_BALANCE_MISMATCH:'Rumus Saldo Tidak Sesuai',
 EMPTY_SKU:'SKU Kosong',EMPTY_NAME:'Nama Barang Kosong',EMPTY_LOCATION:'Lokasi Stok Kosong',
 NAME_MISMATCH:'Nama Berbeda pada SKU Sama',ACCURACY_MISMATCH:'Selisih Data Referensi',
 OUTBOUND_WITHOUT_INBOUND:'Riwayat Masuk Perlu Verifikasi',
 MOVEMENT_NOT_REFLECTED:'Movement Belum Berdampak',MOVEMENT_NO_EFFECT:'Movement Tanpa Perubahan',
});
const SOURCE_NAMES={kartuStok:'Kartu Stok',rpl:'RPL',bulky:'BULKY',barangMasuk:'Barang Masuk',barangKeluar:'Barang Keluar'};
const rank={High:1,Medium:2,Low:3};
export const normalizeWarningSku=value=>String(value??'').replace(/[\u00A0\u200B-\u200D\u2060\uFEFF]/g,'').normalize('NFKC').trim().toUpperCase();
export const normalizeWarningName=value=>normalizeWarningSku(value).replace(/[^\p{L}\p{N}]/gu,'');
const text=value=>String(value??'').trim();
export function warningNumber(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 const raw=text(value);if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))return null;
 const parsed=Number(raw);return Number.isFinite(parsed)?parsed:null;
}
const differs=(a,b)=>Math.abs(a-b)>0.000001;
export function stockBalance(row){
 const values=['stok_awal','internal_stock_transfer','replenishment','pengeluaran','stok_akhir'].map(field=>warningNumber(row[field]));
 if(values.some(value=>value===null))return null;
 const [opening,internal,replenishment,outgoing,closing]=values;
 const expected=opening-internal-replenishment-outgoing;
 return Number.isFinite(expected)?{opening,internal,replenishment,outgoing,closing,expected}:null;
}
function warning(category,severity,source,row,issue,evidence,recommendation,confidence='record'){
 return {id:[category,source,row.source_row_number??row.id??'',normalizeWarningSku(row.sku),text(row.lokasi_bulky),evidence].join(':'),category,categoryLabel:WARNING_CATEGORIES[category],severity,source,sku:text(row.sku)||'-',namaBarang:text(row.nama_barang)||'-',issue,evidence,recommendation,confidence,sourceRecord:row.source_row_number??row.id??null,sourceRow:row.source_row_number??null,location:text(row.lokasi_bulky||row.from_location||row.to_location),eventDate:text(row.tanggal)};
}
export function buildInventoryWarnings(input,{allowCrossSource=true}={}){
 const rows=Object.fromEntries(Object.keys(SOURCE_NAMES).map(key=>[key,Array.isArray(input?.[key])?input[key]:[]]));
 const result=[],names=new Map();
 for(const key of ['kartuStok','rpl','bulky'])for(const row of rows[key]){
  const source=SOURCE_NAMES[key],sku=normalizeWarningSku(row.sku),name=normalizeWarningName(row.nama_barang),stock=warningNumber(row.stok_akhir);
  const rowLabel=`${source} baris ${row.source_row_number??'-'}`;
  // Ignore blank templates and header rows. A zero-stock historical row is not
  // evidence that a current item's name/location is wrong.
  if(sku==='SKU'&&['NAMABARANG','NAMA'].includes(name))continue;
  const hasBusinessData=!!name||['stok_awal','internal_stock_transfer','replenishment','pengeluaran','stok_akhir'].some(field=>{const n=warningNumber(row[field]);return n!==null&&n!==0;});
  if(!hasBusinessData)continue;
  if(!sku)result.push(warning('EMPTY_SKU','Medium',source,row,'Baris berisi data barang tetapi SKU kosong.',`${rowLabel}: nama ${text(row.nama_barang)||'-'}, saldo ${stock??'belum terbaca'}.`,'Lengkapi SKU sesuai barang pada baris tersebut.'));
  if(sku&&stock!==null&&stock!==0&&!name)result.push(warning('EMPTY_NAME','Low',source,row,'SKU bersaldo memiliki nama barang kosong.',`${rowLabel}: saldo ${stock}, SKU ${text(row.sku)}.`,'Isi nama barang berdasarkan master SKU yang benar.'));
  if(sku&&stock!==null&&stock>0&&!normalizeWarningSku(row.lokasi_bulky))result.push(warning('EMPTY_LOCATION','Medium',source,row,'Stok positif tidak memiliki lokasi.',`${rowLabel}: saldo ${stock}, lokasi kosong.`,'Tetapkan lokasi fisik atau lokasi operasional yang sesuai.'));
  if(key==='kartuStok'&&stock!==null&&stock<0)result.push(warning('NEGATIVE_STOCK','High',source,row,`Saldo pada baris ini negatif: ${stock}.`,`${rowLabel}, lokasi ${text(row.lokasi_bulky)||'-'}: stok akhir ${stock}.`,'Periksa saldo awal dan mutasi baris ini; cocokkan dengan kondisi fisik sebelum koreksi.'));
  if(key==='kartuStok'&&sku){const balance=stockBalance(row);if(balance&&differs(balance.expected,balance.closing))result.push(warning('STOCK_BALANCE_MISMATCH','High',source,row,`Stok akhir ${balance.closing} berbeda dari hasil rumus ${balance.expected}.`,`${rowLabel}: ${balance.opening} − ${balance.internal} − ${balance.replenishment} − ${balance.outgoing} = ${balance.expected}; stok akhir tercatat ${balance.closing}.`,'Periksa formula STOK AKHIR pada baris sumber. Tidak dibandingkan dengan total riwayat transaksi.'));}
  if(sku&&name&&stock!==null&&stock!==0){const item=names.get(sku)||[];item.push({source,row,name});names.set(sku,item);}
 }
 for(const items of names.values()){
  const groups=allowCrossSource?[items]:[...new Set(items.map(item=>item.source))].map(source=>items.filter(item=>item.source===source));
  for(const group of groups)if(new Set(group.map(item=>item.name)).size>1){
   const sources=[...new Set(group.map(item=>item.source))];
   const variants=new Map();
   for(const item of group){const variant=variants.get(item.name)||[];variant.push(item);variants.set(item.name,variant);}
   // Show different names, not eight duplicates that can hide the actual conflict.
   const evidence=[...variants.values()].slice(0,8).map(items=>{
    const examples=items.slice(0,3).map(item=>`${item.source} baris ${item.row.source_row_number??'-'} (${text(item.row.lokasi_bulky)||'-'}, saldo ${warningNumber(item.row.stok_akhir)})`).join('; ');
    return `"${text(items[0].row.nama_barang)}": ${examples}${items.length>3?`; +${items.length-3} baris lainnya`:''}`;
   }).join(' | ')+(variants.size>8?` | +${variants.size-8} variasi nama lainnya`:'');
   const finding=warning('NAME_MISMATCH','Medium',sources.join(' / '),group[0].row,`SKU yang sama memiliki ${variants.size} nama berbeda pada ${group.length} baris bersaldo nonnol.`,evidence,'Bandingkan nama dengan master SKU dan dokumen barang. Konfirmasi kemungkinan perubahan nama; jangan otomatis mengganti nama. Huruf besar/kecil, spasi, tanda baca, serta baris stok 0 diabaikan.','review');
   finding.nameVariants=[...variants.values()].map(items=>({name:text(items[0].row.nama_barang),count:items.length}));
   result.push(finding);
  }
 }
 const accuracy=new Map();
 for(const key of ['rpl','bulky'])for(const row of rows[key]){
  const sku=normalizeWarningSku(row.sku);if(!sku)continue;
  const item=accuracy.get(sku)||{row,sources:new Set(),difference:0,valid:true};
  const actual=warningNumber(row.stok_akhir),reference=warningNumber(row.netsuite),difference=warningNumber(row.selisih);
  if(actual===null||reference===null||difference===null||differs(actual-reference,difference))item.valid=false;
  else item.difference+=difference;
  item.sources.add(SOURCE_NAMES[key]);accuracy.set(sku,item);
 }
 if(allowCrossSource)for(const item of accuracy.values())if(item.valid&&differs(item.difference,0))result.push(warning('ACCURACY_MISMATCH','Medium',[...item.sources].join(' / '),item.row,`Selisih referensi terverifikasi: ${item.difference}.`,`Setiap baris SKU memiliki stok, NETSUITE, dan SELISIH yang valid; total selisih ${item.difference}.`,'Verifikasi periode dan tanggal referensi Netsuite sebelum cycle count atau koreksi stok.','review'));
 return result;
}
export function outboundFromWarnings(rows){return (rows||[]).filter(row=>normalizeWarningSku(row.sku)&&warningNumber(row.qty)>0&&['empty','multiple','unknown'].includes(row.reason)).map(row=>{const from=text(row.from_location),multiple=row.reason==='multiple',unknown=row.reason==='unknown',issue=multiple?`From berisi beberapa lokasi: ${from}. Qty ${row.qty} tidak memiliki pembagian lokasi yang jelas.`:unknown?`Lokasi From "${from}" tidak dikenali pada data lokasi saat pemeriksaan.`:'Lokasi From kosong pada transaksi barang keluar.';const finding=warning('INVALID_OUTBOUND_FROM',unknown?'Medium':'High','Barang Keluar',row,issue,`Barang Keluar baris ${row.source_row_number??'-'} • tanggal ${row.tanggal||'-'} • From: ${from||'(kosong)'} • To: ${text(row.to_location)||'-'} • Qty: ${row.qty}.`,multiple?'Pisahkan transaksi per lokasi From dan tulis Qty masing-masing. Jangan gunakan satu Qty untuk gabungan lokasi.':unknown?'Verifikasi lokasi asli dan dokumen transaksi; lokasi khusus dapat berubah. Ketiadaan pada data saat ini tidak membuktikan lokasi historis salah.':'Lengkapi satu lokasi From yang benar sesuai sumber barang.',unknown?'review':'record');finding.eventDate=normalizeTransactionDate(row.tanggal).value||text(row.tanggal);finding.transactionTo=normalizeWarningSku(row.to_location).replace(/\s+/g,' ');finding.fromReason=row.reason;return finding;});}
export function queryInventoryWarnings(allRows,options={}){
 const severity=text(options.severity),category=text(options.category),source=text(options.source),terms=text(options.search).toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean);
 let rows=allRows.filter(row=>(!severity||severity==='all'||row.severity===severity)&&(!category||category==='all'||row.category===category)&&(!source||source==='all'||row.source.split(' / ').includes(source))&&terms.every(term=>`${row.sku} ${row.namaBarang} ${row.issue} ${row.location} ${row.evidence}`.toLocaleLowerCase('id-ID').includes(term)));
 const collator=new Intl.Collator('id-ID',{sensitivity:'base',numeric:true});
 const latest=row=>{const trace=row.deductionTrace,candidates=trace?[...(trace.transactions||[]),...(trace.primary?[trace.primary]:[])]:[{eventDate:row.eventDate,row:row.sourceRow,source:row.source}];return candidates.map(item=>({...item,date:normalizeTransactionDate(item.eventDate||item.date).value||''})).filter(item=>item.date).sort((a,b)=>b.date.localeCompare(a.date)||(a.source===b.source?(Number(b.row)||0)-(Number(a.row)||0):0))[0]||{date:'',row:0};};
 const dated=new Map(rows.map(row=>[row,latest(row)]));const date=row=>dated.get(row).date;
 const comparators={sku:(a,b)=>collator.compare(a.sku,b.sku),name:(a,b)=>collator.compare(a.namaBarang,b.namaBarang),category:(a,b)=>collator.compare(a.categoryLabel,b.categoryLabel),newest:(a,b)=>date(b).localeCompare(date(a))||(dated.get(a).source===dated.get(b).source?(Number(dated.get(b).row)||0)-(Number(dated.get(a).row)||0):0),severity:(a,b)=>(rank[a.severity]||9)-(rank[b.severity]||9)};
 const compare=comparators[options.sort]||comparators.severity;rows.sort((a,b)=>compare(a,b)||collator.compare(a.sku,b.sku)||collator.compare(a.id,b.id));
 const total=rows.length,limit=Math.min(100,Math.max(1,parseInt(options.limit,10)||25)),page=Math.min(Math.max(1,Math.ceil(total/limit)),Math.max(1,parseInt(options.page,10)||1));
 return {rows:options.full===true?rows:rows.slice((page-1)*limit,page*limit),total,page,limit};
}
export async function loadInventoryWarnings(env,options={}){
 const data=await loadWarningData(env),allStockReady=data.verification.filter(item=>['kartu_stok','rpl','bulky'].includes(item.source)).every(item=>item.ready);
 const warnings=attachNegativeStockTraces(buildInventoryWarnings(data.rows,{allowCrossSource:allStockReady}),data.negativeContext,{ready:data.negativeContextReady});if(data.outboundFromReady)warnings.push(...outboundFromWarnings(data.outboundFrom));
 if(data.ledgerReady)for(const row of data.ledger){
  const qty=warningNumber(row.qty);if(!normalizeWarningSku(row.sku)||qty===null||qty<=0)continue;
  warnings.push(warning('OUTBOUND_WITHOUT_INBOUND','Medium','Barang Keluar',row,'Riwayat masuk SKU yang telah keluar belum ditemukan.',`Pengeluaran positif ${qty}; SKU tidak ditemukan di Barang Masuk dan ketiga sumber stok. Baris keluar ${row.source_row_number??'-'}.`,'Verifikasi dokumen penerimaan atau saldo awal. Ketiadaan riwayat bukan bukti barang tidak pernah diterima.','review'));
 }
 const movementStock=['kartuStok','rpl','bulky'].flatMap(key=>data.rows[key].map(row=>({...row,warningSource:SOURCE_NAMES[key]})));
 const stockSnapshots=data.verification.filter(item=>['kartu_stok','rpl','bulky'].includes(item.source)).map(item=>new Date(item.lastSuccess||'').getTime());
 const earliestStockSnapshot=stockSnapshots.every(Number.isFinite)?new Date(Math.min(...stockSnapshots)).toISOString():null;
 const movement=movementImpactFindings(data.movement,movementStock,{normalizeSku:normalizeWarningSku,number:warningNumber,businessDate:businessDateKey(),stockCheckedAt:earliestStockSnapshot});
 if(data.movementReady)for(const item of movement.findings){const finding=warning(item.category,'Medium','Barang Masuk',item.row,item.issue,item.evidence,item.recommendation,item.confidence);finding.location=item.location;warnings.push(finding);}
 const stock=data.rows.kartuStok,referenceRows=[...data.rows.rpl,...data.rows.bulky];
 const validReference=referenceRows.filter(row=>{const a=warningNumber(row.stok_akhir),r=warningNumber(row.netsuite),d=warningNumber(row.selisih);return a!==null&&r!==null&&d!==null&&!differs(a-r,d);});
 const checks=[{key:'balance',label:'Rumus saldo Kartu Stok',checked:stock.filter(row=>stockBalance(row)).length,skipped:stock.filter(row=>!stockBalance(row)).length},{key:'accuracy',label:'Referensi accuracy',checked:validReference.length,skipped:referenceRows.length-validReference.length,note:'Diperiksa hanya jika stok, NETSUITE, dan SELISIH lengkap serta saling cocok.'},{key:'ledger',label:'Riwayat masuk/keluar',ready:data.ledgerReady,note:'Tidak membandingkan jumlah transaksi dengan saldo satu lokasi.'}];
 checks.push({key:'movement',label:'Dampak movement',ready:data.movementReady,checked:data.movementReady?movement.checked:undefined,skipped:movement.skipped,note:data.movementReady?'Memeriksa pengurangan From pada kolom mutasi dan penerimaan To pada STOK AWAL. Saldo/kolom tujuan 0 saja bukan bukti movement gagal. Netto yang saling membatalkan, aktivitas lanjutan, dan input yang belum melewati jeda sinkronisasi tidak disimpulkan sebagai gagal.':'Riwayat movement atau snapshot sumber belum terverifikasi.'});
 checks.push({key:'outbound-from',label:'Lokasi From barang keluar',ready:!!data.outboundFromReady,checked:data.outboundFromReady?data.outboundFrom.length:undefined});
 const byCategory=Object.fromEntries(Object.keys(WARNING_CATEGORIES).map(key=>[key,warnings.filter(row=>row.category===key).length]));
 return {...queryInventoryWarnings(warnings,options),summary:{total:warnings.length,high:warnings.filter(row=>row.severity==='High').length,medium:warnings.filter(row=>row.severity==='Medium').length,low:warnings.filter(row=>row.severity==='Low').length,affectedSku:new Set(warnings.map(row=>normalizeWarningSku(row.sku)).filter(sku=>sku&&sku!=='-')).size,byCategory},categories:WARNING_CATEGORIES,partial:!!(data.unavailableSources.length||data.staleSources?.length),unavailableSources:data.unavailableSources,verification:data.verification,checks,checkedAt:new Date().toISOString(),businessDate:businessDateKey()};
}
