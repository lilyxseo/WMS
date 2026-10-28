// Detect product records from their values when document headers are absent.
// Ambiguous quantities are reported for review rather than guessed.
const text=value=>String(value??'').trim();
export function isEntryContentSku(value){
 const sku=text(value);
 if(/^\d{8,18}$/.test(sku))return true;
 if(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(sku)||/^[A-Z]{1,3}\d{1,3}(?:-\d{1,3}){1,3}(?:-[A-Z])?$/i.test(sku))return false;
 return /^(?=.{5,50}$)(?=.*[A-Z])[A-Z0-9]+(?:[-/][A-Z0-9]+)+$/i.test(sku)&&!/^T-\d+$/i.test(sku);
}
function quantity(value){
 const match=text(value).match(/^(\d+(?:[.,]\d+)?)\s*(?:pcs|pc|unit|buah|ea)?$/i);
 if(!match)return null;
 const qty=Number(match[1].replace(',','.'));return Number.isFinite(qty)&&qty>0?qty:null;
}
const nameCandidate=value=>/[A-Za-z]/.test(value)&&/\s/.test(value)&&!/^\s*(?:total|subtotal|grand total|nomor|tanggal|alamat|dari|kepada)\b/i.test(value);
export function parseEntryContentRows(rows){
 const items=[],failedRows=[];
 for(const row of rows){
  let cells=(row.values||[]).map(text).filter(Boolean);
  if(!cells.length||/^(?:grand\s*total|sub\s*total|total)\b/i.test(cells[0]))continue;
  // A PDF text extractor can return an entire product row as one text item.
  if(cells.length===1){
   const tokens=cells[0].split(/\s+/),skuAt=tokens.findIndex(isEntryContentSku);
   if(skuAt<0)continue;
   const tail=tokens.slice(skuAt+1),last=tail.length-1;
   const unit=/^(pcs|pc|unit|buah|ea)$/i.test(tail[last]||'');
   const qtyAt=unit?last-1:last,qty=quantity(tail.slice(qtyAt).join(' ')),name=tail.slice(0,qtyAt).join(' ');
   if(qty&&nameCandidate(name)){items.push({sku:tokens[skuAt],namaProduk:name,qty});continue;}
   failedRows.push({row:row.number,reason:'SKU terbaca; nama atau Qty perlu diperiksa'});continue;
  }
  const skuIndexes=cells.flatMap((value,index)=>isEntryContentSku(value)?[index]:[]);
  if(!skuIndexes.length)continue;
  if(skuIndexes.length!==1){failedRows.push({row:row.number,reason:'Lebih dari satu kode barang; periksa SKU'});continue;}
  const skuAt=skuIndexes[0],names=[];
  for(let index=0;index<cells.length;index++){
   if(index===skuAt||quantity(cells[index])!==null||!/[A-Za-z]/.test(cells[index]))continue;
   const start=index,parts=[cells[index]];
   while(index+1<cells.length&&index+1!==skuAt&&quantity(cells[index+1])===null&&/[A-Za-z]/.test(cells[index+1]))parts.push(cells[++index]);
   const value=parts.join(' ');if(nameCandidate(value))names.push({value,index:start,end:index});
  }
  if(names.length!==1){failedRows.push({row:row.number,reason:'Nama barang belum jelas'});continue;}
  const name=names[0],quantities=cells.flatMap((value,index)=>index!==skuAt&&index!==name.index&&quantity(value)!==null?[{index,qty:quantity(value)}]:[]);
  // Row numbers before the product are not quantities when a value follows it.
  const following=quantities.filter(q=>q.index>Math.max(skuAt,name.end)),candidates=following.length?following:quantities;
  if(candidates.length!==1){failedRows.push({row:row.number,reason:'Qty belum jelas; periksa jumlah barang'});continue;}
  items.push({sku:cells[skuAt],namaProduk:name.value,qty:candidates[0].qty});
 }
 return {items,failedRows};
}
export async function entryImportFileKind(file){
 const bytes=new Uint8Array(await file.slice(0,1024).arrayBuffer());
 const prefix=String.fromCharCode(...bytes);
 if(prefix.includes('%PDF-'))return 'pdf';
 if(bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04)return 'excel';
 throw Error('Isi file bukan PDF atau Excel (.xlsx) yang didukung.');
}
