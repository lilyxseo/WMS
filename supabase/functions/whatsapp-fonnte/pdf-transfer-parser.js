// Transfer table conversion adapted from the WMS application PDF import parser.
const clean = v => String(v || "").toLowerCase().trim().replace(/[_-]+/g," ").replace(/\s+/g," ");
function isSkuCandidate(text){return /^[A-Za-z0-9][A-Za-z0-9\-\/.]{0,199}$/.test(String(text||"").trim());}
export function cleanupTransferHeaderValue(value){
let text=String(value||"").trim();
text=text.replace(/\bTanggal\s+Dibuat\b.*$/i,"").trim();
text=text.replace(/\bPerkiraan\s+Tanggal\s+Sampai\b.*$/i,"").trim();
return text.replace(/\s{2,}/g," ").trim();
}
function normalizeTransferCsvHeader(value){return clean(String(value||"")).replace(/[^a-z0-9]+/g,' ').trim();}
function isTransferCsvNumber(value){return /^-?\d+(?:[.,]\d+)?$/.test(String(value??'').trim().replace(/\./g,'').replace(',', '.'));}
function splitCollapsedTransferCsvLine(line){
const text=String(line||'').replace(/\s+/g,' ').trim();
if(!text||/^(sku|nama\s+produk|jumlah|diterima|batal|tolak|catatan)\b/i.test(text))return null;
const tokens=text.split(' ').filter(Boolean);
const skuIndex=tokens.findIndex(tok=>isSkuCandidate(tok));
if(skuIndex<0)return null;
const sku=tokens[skuIndex];
const tail=tokens.slice(skuIndex+1);
const numericIndexes=[];
for(let i=0;i<tail.length;i++)if(isTransferCsvNumber(tail[i]))numericIndexes.push(i);
if(!numericIndexes.length)return [sku,tail.join(' '),'','','','',''];
let qtyIndex=numericIndexes[0];
if(numericIndexes.length>=4){
const consecutiveStart=numericIndexes.find((idx,pos)=>numericIndexes[pos+1]===idx+1&&numericIndexes[pos+2]===idx+2&&numericIndexes[pos+3]===idx+3);
if(consecutiveStart!==undefined)qtyIndex=consecutiveStart;
}
const namaProduk=tail.slice(0,qtyIndex).join(' ').trim();
const qty=tail[qtyIndex]||'';
const diterima=tail[qtyIndex+1]||'';
const batal=tail[qtyIndex+2]||'';
const tolak=tail[qtyIndex+3]||'';
const catatan=tail.slice(qtyIndex+4).join(' ').trim();
return [sku,namaProduk,qty,diterima,batal,tolak,catatan];
}
function repairTransferCsvRow(row){
const cells=(row||[]).map(c=>String(c||'').trim());
const nonEmpty=cells.filter(Boolean);
if(nonEmpty.length!==1)return null;
return splitCollapsedTransferCsvLine(nonEmpty[0]);
}
function cleanTransferFooterText(value){return String(value||'').replace(/\b(?:Disiapkan|Dikirimkan|Diterima)\s+Oleh\b.*$/i,'').replace(/\s+/g,' ').trim();}
function isTransferFooterText(value){return /\b(?:Disiapkan|Dikirimkan|Diterima)\s+Oleh\b/i.test(String(value||''));}
function isTransferHeaderLikeLine(line){return /\b(SKU|Nama\s+Produk|Nama\s+Barang|Jumlah|Qty|Diterima|Batal|Tolak|Catatan)\b/i.test(String(line||''));}
function hasTransferQtyValue(split){return split&&String(split[2]||'').trim()&&isTransferCsvNumber(split[2]);}
function findTransferTextTableStart(textRows){
const rows=textRows||[];
for(let i=0;i<Math.min(rows.length,90);i++){
const combined=rows.slice(i,i+4).join(' ');
if(/\bSKU\b/i.test(combined)&&/(Nama\s+Produk|Nama\s+Barang|Produk|Description)/i.test(combined)&&/(Jumlah|Qty|Diterima|Batal|Tolak)/i.test(combined))return i;
}
const firstData=rows.findIndex(row=>hasTransferQtyValue(splitCollapsedTransferCsvLine(row)));
return firstData>0?firstData-1:firstData;
}
export function textRowsToTransferCsvRows(textRows){
const startIdx=findTransferTextTableStart(textRows);
if(startIdx<0)return [];
const csvRows=[['SKU','Nama Produk','Jumlah','Diterima','Batal','Tolak','Catatan']];
let foundData=false;
for(let i=startIdx+1;i<textRows.length;i++){
const line=String(textRows[i]||'').replace(/\s+/g,' ').trim();
if(!line)continue;
if(foundData&&/^(grand\s+total|total|status\s+transfer|nomor\s+referensi|perkiraan\s+tanggal)\b/i.test(line))break;
const split=splitCollapsedTransferCsvLine(line);
if(split&&hasTransferQtyValue(split)){csvRows.push(split);foundData=true;continue;}
if(!foundData&&isTransferHeaderLikeLine(line))continue;
if(foundData&&split){csvRows.push(split);continue;}
if(foundData)csvRows.push([line,'','','','','','']);
}
return csvRows.length>1?csvRows:[];
}
function mapTransferCsvDataRow(row,map){
let cells=row||[], rowMap=map;
const repaired=cells.length<=1?repairTransferCsvRow(cells):null;
if(repaired){cells=repaired;rowMap={sku:0,namaProduk:1,qty:2,diterima:3,batal:4,tolak:5,catatan:6};}
const read=field=>String(rowMap[field]!==undefined?cells[rowMap[field]]??'':'').trim();
const rawQty=read('qty'), qty=Number(rawQty.replace(/\./g,'').replace(',', '.'));
const item={sku:read('sku'),namaProduk:cleanTransferFooterText(read('namaProduk')),qty,diterima:read('diterima'),batal:read('batal'),tolak:read('tolak'),catatan:cleanTransferFooterText(read('catatan'))};
const reasons=[];
if(!item.sku)reasons.push('SKU kosong');
if(!rawQty||!Number.isFinite(qty)||qty<0)reasons.push('Jumlah/Qty bukan angka 0 atau lebih');
return {item,row:cells,reason:reasons.join(', ')};
}
function detectTransferCsvColumnMap(headers){
const aliases={
sku:['sku','kode sku','kode barang','item code'],
namaProduk:['nama produk','nama barang','produk','nama','item','description','item name'],
qty:['jumlah','qty','quantity','kuantitas'],
diterima:['diterima','received'],
batal:['batal','cancel','cancelled'],
tolak:['tolak','ditolak','reject','rejected'],
catatan:['catatan','note','notes','keterangan']
};
const normalized=(headers||[]).map(normalizeTransferCsvHeader);
const map={};
const detected=[];
for(const [field,names] of Object.entries(aliases)){
const idx=normalized.findIndex(h=>names.some(name=>h===name||h.includes(name)));
if(idx>=0){map[field]=idx;detected.push(`${headers[idx]||`Kolom ${idx+1}`} → ${field}`);}
}
return {map,detected,normalized};
}
function findTransferCsvHeaderIndex(rows){
let best={idx:-1,score:0,map:{},detected:[]};
(rows||[]).slice(0,40).forEach((row,idx)=>{
const hit=detectTransferCsvColumnMap(row||[]);
const score=(hit.map.sku!==undefined?3:0)+(hit.map.qty!==undefined?3:0)+(hit.map.namaProduk!==undefined?2:0)+Object.keys(hit.map).length;
if(score>best.score)best={idx,score,map:hit.map,detected:hit.detected};
});
return best.score>=4?best:{idx:-1,score:0,map:{},detected:[]};
}
export function parseTransferCsvRows(csvRows){
const headerHit=findTransferCsvHeaderIndex(csvRows);
const warnings=[];
const failedRows=[];
if(headerHit.idx<0){
warnings.push('Format tabel PDF tidak cocok. Periksa file atau edit preview sebelum import.');
return {headerIndex:-1,headers:[],items:[],warnings,failedRows,detectedColumns:[]};
}
const headers=csvRows[headerHit.idx]||[];
const {map,detected}=detectTransferCsvColumnMap(headers);
if(map.sku===undefined)warnings.push('Kolom SKU tidak terdeteksi.');
if(map.qty===undefined)warnings.push('Kolom Jumlah/Qty tidak terdeteksi.');
[['namaProduk','Nama Produk'],['diterima','Diterima'],['batal','Batal'],['tolak','Tolak'],['catatan','Catatan']].forEach(([field,label])=>{if(map[field]===undefined)warnings.push(`Kolom ${label} tidak terdeteksi; nilai akan kosong.`);});
const items=[];
for(let r=headerHit.idx+1;r<csvRows.length;r++){
let row=csvRows[r]||[];
const rowText=row.map(c=>String(c||'').trim()).filter(Boolean).join(' ');
if(!rowText)continue;
if(/^(grand\s+total|total|status\s+transfer|nomor\s+referensi)\b/i.test(rowText))break;
const mapped=mapTransferCsvDataRow(row,map);
if(mapped.reason){failedRows.push({rowNumber:r+1,row:mapped.row,reason:mapped.reason});continue;}
items.push(mapped.item);
}
if(!items.length)warnings.push('Tidak ada row valid dari CSV. Import diblokir sampai minimal ada satu row valid.');
return {headerIndex:headerHit.idx,headers,items,warnings,failedRows,detectedColumns:detected};
}
function getPdfItemX(item){return Number(item?.transform?.[4]||0);}
function getPdfItemY(item){return Number(item?.transform?.[5]||0);}
export function groupPdfItemsByRows(items){
const sorted=(items||[]).filter(it=>String(it?.str||'').trim()).sort((a,b)=>getPdfItemY(b)-getPdfItemY(a)||getPdfItemX(a)-getPdfItemX(b));
const rows=[];
for(const item of sorted){
const y=getPdfItemY(item);
let row=rows.find(r=>Math.abs(r.y-y)<=3);
if(!row){row={y,items:[]};rows.push(row);}
row.items.push(item);
}
rows.forEach(r=>r.items.sort((a,b)=>getPdfItemX(a)-getPdfItemX(b)));
return rows;
}
function findPdfHeaderAnchor(flat,field){
const byRaw=pattern=>flat.find(entry=>pattern.test(entry.raw));
const byNorm=pattern=>flat.find(entry=>pattern.test(entry.norm));
if(field==='no')return byRaw(/^#$/)||byNorm(/^(no|nomor)$/);
if(field==='namaProduk')return byNorm(/produk|nama\s+produk|nama\s+barang|description/);
if(field==='sku')return byNorm(/kode\s+barang|sku|kode\s+sku|item\s+code/);
if(field==='qty')return byNorm(/^(jumlah|qty|quantity|kuantitas)$/)||byNorm(/jumlah|qty|quantity|kuantitas/);
if(field==='diterima')return byNorm(/diterima|received/);
if(field==='batal')return byNorm(/batal|cancel/);
if(field==='tolak')return byNorm(/tolak|reject/);
if(field==='catatan')return byNorm(/catatan|note|keterangan/);
return null;
}
export function detectPdfTableColumns(pdfRows){
const fields=['no','namaProduk','sku','qty','diterima','batal','tolak','catatan'];
const labels={no:'#',namaProduk:'Nama Produk',sku:'SKU',qty:'Jumlah',diterima:'Diterima',batal:'Batal',tolak:'Tolak',catatan:'Catatan'};
for(let ri=0;ri<Math.min(pdfRows.length,120);ri++){
const windowRows=pdfRows.slice(ri,ri+5);
const combined=normalizeTransferCsvHeader(windowRows.map(row=>row.items.map(it=>it.str).join(' ')).join(' '));
const hasProduct=/produk|nama\s+produk|nama\s+barang|description/.test(combined);
const hasSku=/sku|kode\s+barang|kode\s+sku|item\s+code/.test(combined);
const hasQty=/jumlah|qty|quantity|kuantitas/.test(combined);
if(!(hasProduct&&hasSku&&hasQty))continue;
const flat=[];
windowRows.forEach((row,offset)=>row.items.forEach(it=>flat.push({it,rowIndex:ri+offset,raw:String(it.str||'').trim(),norm:normalizeTransferCsvHeader(it.str),x:getPdfItemX(it)})));
const anchors=[];
for(const field of fields){
const found=findPdfHeaderAnchor(flat,field);
if(found)anchors.push({field,label:labels[field],x:found.x,rowIndex:found.rowIndex});
}
if(anchors.some(a=>a.field==='namaProduk')&&anchors.some(a=>a.field==='sku')&&anchors.some(a=>a.field==='qty')){
anchors.sort((a,b)=>a.x-b.x);
return {headerRowIndex:Math.max(...anchors.map(a=>a.rowIndex)),columns:anchors};
}
}
return {headerRowIndex:-1,columns:[]};
}
function appendPdfCell(target,field,value){
const text=String(value||'').replace(/\s+/g,' ').trim();
if(!text)return;
target[field]=target[field]?`${target[field]} ${text}`:text;
}
export function pdfRowsToCsvRows(pdfRows){
const detected=detectPdfTableColumns(pdfRows);
if(detected.headerRowIndex<0)return [];
const columns=detected.columns;
const boundaries=columns.map((col,idx)=>idx===0?-Infinity:(columns[idx-1].x+col.x)/2).concat([Infinity]);
const outputFields=['sku','namaProduk','qty','diterima','batal','tolak','catatan'];
const outputHeaders=['SKU','Nama Produk','Jumlah','Diterima','Batal','Tolak','Catatan'];
const getRowCells=(row)=>{
const rowCells={};
for(const item of row.items){
const text=String(item.str||'').trim();
if(!text)continue;
const x=getPdfItemX(item);
let ci=0;
for(let b=0;b<columns.length;b++){if(x>=boundaries[b]&&x<boundaries[b+1]){ci=b;break;}}
const field=columns[ci]?.field;
if(field)appendPdfCell(rowCells,field,text);
}
return rowCells;
};
const isIgnoredRow=(rowText)=>/^(transfer\s*#|dari\b|kepada\b|nomor\s+referensi|tanggal\s+dibuat|perkiraan\s+tanggal|status\s+transfer)/i.test(rowText)||isTransferFooterText(rowText)||isTransferHeaderLikeLine(rowText)&&/(kode\s+barang|sku|jumlah|qty)/i.test(rowText);
const isSummaryQtyOnlyRow=(rowCells)=>isTransferCsvNumber(rowCells.qty)&&!String(rowCells.no||'').trim()&&!String(rowCells.sku||'').trim()&&!String(rowCells.namaProduk||'').trim()&&!String(rowCells.diterima||'').trim()&&!String(rowCells.batal||'').trim()&&!String(rowCells.tolak||'').trim()&&!String(rowCells.catatan||'').trim();
const skuRowIndexes=[];
for(let ri=detected.headerRowIndex+1;ri<pdfRows.length;ri++){
const row=pdfRows[ri];
const rowText=row.items.map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
if(!rowText||isIgnoredRow(rowText))continue;
if(/^(grand\s+total|total)\b/i.test(rowText))break;
const rowCells=getRowCells(row);
const sku=String(rowCells.sku||'').trim();
// Keep malformed item rows as well: validation must report them, never omit them.
if(sku || String(rowCells.namaProduk||'').trim() && isTransferCsvNumber(rowCells.qty))skuRowIndexes.push(ri);
}
const records=[];
for(let si=0;si<skuRowIndexes.length;si++){
const start=skuRowIndexes[si];
const end=skuRowIndexes[si+1]||pdfRows.length;
const record={};
for(let ri=start;ri<end;ri++){
const row=pdfRows[ri];
const rowText=row.items.map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
if(!rowText||isIgnoredRow(rowText))continue;
if(ri>start&&/^(grand\s+total|total)\b/i.test(rowText))break;
const rowCells=getRowCells(row);
if(ri>start&&isSummaryQtyOnlyRow(rowCells))break;
if(ri===start){
appendPdfCell(record,'sku',rowCells.sku);
appendPdfCell(record,'namaProduk',rowCells.namaProduk);
if(isTransferCsvNumber(rowCells.qty))appendPdfCell(record,'qty',rowCells.qty);else appendPdfCell(record,'namaProduk',rowCells.qty);
appendPdfCell(record,'diterima',rowCells.diterima);
appendPdfCell(record,'batal',rowCells.batal);
appendPdfCell(record,'tolak',rowCells.tolak);
appendPdfCell(record,'catatan',rowCells.catatan);
continue;
}
appendPdfCell(record,'namaProduk',rowCells.namaProduk);
if(rowCells.qty){
if(!record.qty&&isTransferCsvNumber(rowCells.qty))appendPdfCell(record,'qty',rowCells.qty);
else appendPdfCell(record,'namaProduk',rowCells.qty);
}
for(const field of ['diterima','batal','tolak']){
const value=String(rowCells[field]||'').trim();
if(!value)continue;
if(isTransferCsvNumber(value)&&!String(record[field]||'').trim())appendPdfCell(record,field,value);
else appendPdfCell(record,'namaProduk',value);
}
appendPdfCell(record,'catatan',rowCells.catatan);
}
if(outputFields.some(field=>String(record[field]||'').trim()))records.push(record);
}
const csvRows=[outputHeaders];
for(const record of records){
const row=outputFields.map(field=>String(record[field]||'').trim());
if(row.some(Boolean))csvRows.push(row);
}
return csvRows.length>1?csvRows:[];
}
