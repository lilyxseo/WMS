import {readXlsxWorkbook} from './xlsx-preview.js';
import {parseEntryContentRows} from './entry-import-content.js';
const normal=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={sku:['sku','kodesku','itemcode','kodebarang','productsku'],name:['namabarang','namaproduk','productname','itemname','description','nama','name'],qty:['qty','quantity','jumlah','jumlahbarang','transferqty']};
export function excelEntryItems(rows){
 let header=-1,columns;
 for(let i=0;i<Math.min(rows.length,50);i++){const values=rows[i].values||[];const found=Object.fromEntries(Object.entries(aliases).map(([field,names])=>[field,values.flatMap((value,col)=>names.includes(normal(value))?[col]:[])]));if(found.sku.length&&found.qty.length){if(Object.values(found).some(list=>list.length>1))throw Error('Kolom SKU/nama/Qty ganda. Gunakan satu kolom untuk setiap data.');header=i;columns=Object.fromEntries(Object.entries(found).map(([k,list])=>[k,list[0]??-1]));break;}}
 if(header<0){const parsed=parseEntryContentRows(rows);if(!parsed.items.length)throw Error('Data barang tidak ditemukan. Pastikan SKU, nama barang, dan Qty terbaca.');return parsed;}
 const items=[],failedRows=[];
 for(const row of rows.slice(header+1)){const cells=row.values||[],sku=String(cells[columns.sku]??'').trim(),name=String(cells[columns.name]??'').trim(),raw=String(cells[columns.qty]??'').trim();if(!sku&&!name&&!raw)continue;if(/^(grand\s*total|sub\s*total|total)$/i.test(sku))continue;if(aliases.sku.includes(normal(sku))&&aliases.qty.includes(normal(raw)))continue;const qty=Number(raw);if(!sku||!raw||!Number.isFinite(qty)||qty<=0){failedRows.push({row:row.number,reason:'Periksa SKU dan Qty'});continue;}items.push({sku,namaProduk:name,qty});}
 if(!items.length)throw Error('Tidak ada barang dengan SKU dan Qty valid.');return {items,failedRows};
}
export async function parseEntryExcel(file,sheetIndex){
 const workbook=await readXlsxWorkbook(await file.arrayBuffer());
 if(workbook.sheets.length>1&&sheetIndex===undefined)return {sheets:workbook.sheets.map(sheet=>sheet.name)};
 const sheet=await workbook.readSheet(sheetIndex??0);if(sheet.truncated)throw Error('Sheet terlalu besar. Maksimal 2.000 baris dan 100 kolom; draft belum diubah.');return excelEntryItems(sheet.rows);
}
