const text=value=>String(value??'').trim();
const header=value=>text(value).normalize('NFKC').toLowerCase().replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const skuHeader=value=>/^(?:sku(?: [\p{L}\p{N} ]+)?|kode(?: (?:sku|barang|produk|item))?|item (?:code|number|no|id)|product code|product sku|stock code|code item)$/u.test(header(value));
const barcodeHeader=value=>['barcode','bar code','kode barcode'].includes(header(value));
const businessHeader=value=>/^(?:nama|name|description|deskripsi|item name|product name|qty|quantity|jumlah|stok|stock|saldo|count|hasil|aktual|actual|selisih|variance|lokasi|location|rak|bin|area|from|to|tanggal|date|pic|catatan|keterangan|status|netsuite|uom|satuan)(?: |$)/.test(header(value));
const knownHeader=value=>skuHeader(value)||barcodeHeader(value)||businessHeader(value)||/^(no|nomor|check|centang|checked)$/.test(header(value));
export const sheetSku=value=>text(value).normalize('NFKC').toUpperCase();
export function sheetColumn(index){let value='';for(index++;index>0;index=Math.floor((index-1)/26))value=String.fromCharCode(65+(index-1)%26)+value;return value;}

function headerBand(values,row,skuColumn){
 const rows=[row];
 // A header may span two/three rows. Never consume a populated SKU data row.
 for(const offset of [-1,1]){
  const adjacent=values[row+offset]||[];
  if((!text(adjacent[skuColumn])||skuHeader(adjacent[skuColumn])||barcodeHeader(adjacent[skuColumn]))&&adjacent.filter(knownHeader).length>=2)rows.push(row+offset);
 }
 rows.sort((a,b)=>a-b);
 const width=Math.max(...rows.map(index=>values[index]?.length||0));
 const labels=Array.from({length:width},(_,column)=>[...new Set(rows.map(index=>text(values[index]?.[column])).filter(Boolean))].join(' / '));
 return {rows,labels};
}

// Discover schemas rather than requiring a header for every physical data block.
// COUNT 1 can reuse one header for two vertically separated blocks, or use
// different/multiline headers in its two tables. All matching rows are retained.
export function findSkuTables(values){
 const tables=[];
 for(let row=0;row<values.length;row++){
  const cells=values[row]||[];
  const identifiers=cells.flatMap((cell,column)=>skuHeader(cell)||barcodeHeader(cell)?[column]:[]);
  for(const skuColumn of identifiers){
   const band=headerBand(values,row,skuColumn),labels=band.labels;
   let start=skuColumn,end=skuColumn+1;
   while(start>0&&text(labels[start-1]))start--;
   while(end<labels.length&&text(labels[end]))end++;
   // Preserve any unrecognized business labels between recognized columns.
   const sameRow=cells.flatMap((cell,column)=>skuHeader(cell)?[column]:[]);
   const otherSku=sameRow.filter(column=>column!==skuColumn&&column>=start&&column<end);
   if(barcodeHeader(cells[skuColumn])&&otherSku.length)continue;
   if(otherSku.length){
    const previous=otherSku.filter(column=>column<skuColumn).at(-1),next=otherSku.find(column=>column>skuColumn);
    if(previous!==undefined){const repeated=cells.findIndex((cell,column)=>column>previous&&column<=skuColumn&&text(cell)&&cells.slice(start,previous+1).some(prior=>header(prior)===header(cell)));start=repeated>=0?repeated:skuColumn;}
    if(next!==undefined){const repeated=cells.findIndex((cell,column)=>column>skuColumn&&column<=next&&text(cell)&&cells.slice(start,skuColumn+1).some(prior=>header(prior)===header(cell)));end=repeated>=0?repeated:next;}
   }
   if(!band.rows.some(index=>(values[index]||[]).slice(start,end).some((cell,offset)=>start+offset!==skuColumn&&businessHeader(cell))))continue;
   const candidate={headerRow:band.rows[0],dataStartRow:band.rows.at(-1)+1,start,end,skuColumn,headers:labels.slice(start,end)};
   const existing=tables.find(table=>table.skuColumn===skuColumn&&table.start===start&&table.end===end&&candidate.headerRow<table.dataStartRow&&candidate.dataStartRow>table.headerRow);
   if(existing){existing.dataStartRow=Math.max(existing.dataStartRow,candidate.dataStartRow);continue;}
   tables.push(candidate);
  }
 }
 return tables.sort((a,b)=>a.headerRow-b.headerRow||a.start-b.start);
}
export function readSkuTables(values,sku,{sheetName='',sourceName=''}={}){
 if(!Array.isArray(values))throw Error('Respons sheet tidak valid.');
 const tables=findSkuTables(values);
 if(!tables.length)throw Error(`${sheetName}: kolom SKU dan header data belum dapat dikenali.`);
 return tables.map((table,index)=>{
  const stop=tables.find(other=>other.headerRow>=table.dataStartRow&&other.start<table.end&&other.end>table.start)?.headerRow??values.length;
  const rows=[];
  for(let row=table.dataStartRow;row<stop;row++){
   const cells=values[row]||[];if(sheetSku(cells[table.skuColumn])!==sheetSku(sku))continue;
   const record={sku:text(cells[table.skuColumn]),sheet:sheetName,tabel:index+1,baris:row+1};
   for(let column=table.start;column<table.end;column++){
    const label=table.headers[column-table.start]||`Kolom ${sheetColumn(column)}`;
    const name=Object.hasOwn(record,label)?`${label} (${sheetColumn(column)})`:label;record[name]=cells[column]??'';
   }
   rows.push(record);
  }
  return {name:`${sourceName} · ${sheetName} · Tabel ${index+1} (${sheetColumn(table.start)}${table.headerRow+1}:${sheetColumn(table.end-1)})`,rows};
 });
}
