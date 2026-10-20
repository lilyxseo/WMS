import {createInventorySyncService,normalizeSku,normalizeText,normalizeNumber,normalizedHeader,normalizeDate,SyncError} from './_sync-engine.js';
export const NETSUITE_SHEET_NAME='2 SOH NETSUITE';
const FIELDS=[['SKU','sku'],['NAMA BARANG','nama_barang'],['SALDO AWAL','saldo_awal'],['RECEIPTS','receipts'],['TOTAL QTY MASUK','total_qty_masuk'],['SALES','sales'],['TOTAL QTY KELUAR','total_qty_keluar'],['SALDO AKHIR','saldo_akhir']];
async function parseValues(values,helpers){
 const headerRow=values.findIndex((row,index)=>index<30&&Array.isArray(row)&&['SKU','NAMA BARANG','SALDO AKHIR'].every(header=>row.some(cell=>normalizedHeader(cell)===header)));
 if(headerRow<0)throw new SyncError('INVALID_HEADER','Header SKU, NAMA BARANG, SALDO AKHIR NetSuite tidak ditemukan.');
 const indexes=new Map(values[headerRow].map((cell,index)=>[normalizedHeader(cell),index]));
 const missing=FIELDS.filter(([header])=>!indexes.has(header)).map(([header])=>header);
 if(missing.length)throw new SyncError('INVALID_HEADER','Kolom NetSuite belum lengkap.',{missingHeader:missing,headerRowNumber:headerRow+1});
 const reportDate=values.slice(0,headerRow).flat().map(normalizeDate).find(date=>date.valid&&date.value)?.value||null;
 const rows=[],sourceKeys=new Set();
 for(let index=headerRow+1;index<values.length;index++){
  const cells=values[index]||[],sku=normalizeSku(cells[indexes.get('SKU')]),nama=normalizeText(cells[indexes.get('NAMA BARANG')]);
  if(!sku&&!nama)continue;
  if(!nama&&/^(grand\s+)?total$/i.test(sku))continue;
  if(!sku)throw new SyncError('INVALID_SOURCE_ROW',`SKU NetSuite kosong pada baris ${index+1}.`);
  const row={sku,nama_barang:nama,report_date:reportDate,source_row_key:helpers.buildSourceRowKey(index+1),source_row_number:index+1};
  for(const [header,field] of FIELDS.slice(2)){const number=normalizeNumber(cells[indexes.get(header)]);if(!number.valid)throw new SyncError('INVALID_SOURCE_ROW',`Angka ${header} NetSuite tidak valid pada baris ${index+1}.`);row[field]=number.value;}
  row.source_hash=await helpers.buildSourceHash(row);sourceKeys.add(row.source_row_key);rows.push(row);
 }
 if(!rows.length)throw new SyncError('EMPTY_SOURCE','Tidak ada data SKU NetSuite; snapshot sebelumnya dipertahankan.');
 return {rows,sourceKeys,sourceRowCount:rows.length,invalidRows:[]};
}
const service=createInventorySyncService({source:'netsuite',sheetName:NETSUITE_SHEET_NAME,sheetRange:`'${NETSUITE_SHEET_NAME}'!A:H`,tableName:'netsuite',parseValues,hashFields:[...FIELDS.map(([,field])=>field),'report_date']});
export const syncNetsuite=service.sync;
export const fetchNetsuiteValues=service.fetchValues;
export const parseNetsuiteValues=values=>parseValues(values,service);
