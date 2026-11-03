const text=value=>String(value??'').trim();
const header=value=>text(value).normalize('NFKC').toLowerCase().replace(/[_\n\r]+/g,' ').replace(/\s+/g,' ');
const skuHeader=value=>['sku','kode sku','sku code','kode barang','item code','kode item'].includes(header(value));
const businessHeader=value=>/nama|name|qty|quantity|jumlah|stok|stock|count|aktual|actual|selisih|lokasi|location|from|to|tanggal/.test(header(value));
export const sheetSku=value=>text(value).normalize('NFKC').toUpperCase();
export function sheetColumn(index){let value='';for(index++;index>0;index=Math.floor((index-1)/26))value=String.fromCharCode(65+(index-1)%26)+value;return value;}

// Discover every header block, including horizontally adjacent or vertically
// stacked tables. Keep absolute sheet rows/columns and never coerce SKU to number.
export function findSkuTables(values){
 const tables=[];
 for(let row=0;row<values.length;row++){
  const cells=values[row]||[],skus=cells.flatMap((cell,column)=>skuHeader(cell)?[column]:[]);
  for(let i=0;i<skus.length;i++){
   const skuColumn=skus[i],previous=skus[i-1]??-1,next=skus[i+1]??cells.length;
   let start=0,end=cells.length;
   if(i>0){
    const blank=cells.findLastIndex((cell,column)=>column>previous&&column<skuColumn&&!text(cell));
    if(blank>=0)start=blank+1;
    else {const repeated=cells.findIndex((cell,column)=>column>previous&&column<=skuColumn&&text(cell)&&cells.slice(0,previous+1).some(prior=>header(prior)===header(cell)));start=repeated>=0?repeated:skuColumn;}
   }
   if(i<skus.length-1){
    const blank=cells.findLastIndex((cell,column)=>column>skuColumn&&column<next&&!text(cell));
    if(blank>=0)end=blank;
    else {const repeated=cells.findIndex((cell,column)=>column>skuColumn&&column<=next&&text(cell)&&cells.slice(start,skuColumn+1).some(prior=>header(prior)===header(cell)));end=repeated>=0?repeated:next;}
   }
   while(start<skuColumn&&!text(cells[start]))start++;
   while(end>skuColumn+1&&!text(cells[end-1]))end--;
   if(!cells.slice(start,end).some((cell,index)=>start+index!==skuColumn&&businessHeader(cell)))continue;
   tables.push({headerRow:row,start,end,skuColumn,headers:cells.slice(start,end)});
  }
 }
 return tables;
}
export function readSkuTables(values,sku,{sheetName='',sourceName='',minimumTables=1}={}){
 if(!Array.isArray(values))throw Error('Respons sheet tidak valid.');
 const tables=findSkuTables(values);
 if(tables.length<minimumTables)throw Error(`${sheetName}: ${minimumTables===2?'kedua tabel':'header SKU'} belum dapat dikenali. Periksa posisi header sumber.`);
 return tables.map((table,index)=>{
  const stop=tables.find(other=>other.headerRow>table.headerRow&&other.start<table.end&&other.end>table.start)?.headerRow??values.length;
  const rows=[];
  for(let row=table.headerRow+1;row<stop;row++){
   const cells=values[row]||[];if(sheetSku(cells[table.skuColumn])!==sheetSku(sku))continue;
   const record={sku:text(cells[table.skuColumn]),sheet:sheetName,tabel:index+1,baris:row+1};
   for(let column=table.start;column<table.end;column++){
    const label=text(values[table.headerRow]?.[column])||`Kolom ${sheetColumn(column)}`;
    const name=Object.hasOwn(record,label)?`${label} (${sheetColumn(column)})`:label;record[name]=cells[column]??'';
   }
   rows.push(record);
  }
  return {name:`${sourceName} · ${sheetName} · Tabel ${index+1} (${sheetColumn(table.start)}${table.headerRow+1}:${sheetColumn(table.end-1)})`,rows};
 });
}
