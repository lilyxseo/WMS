import {APP_CONFIG} from '../../assets/js/config.js';
export const MAX_ENTRY_ROWS=1000;
export const STATUSES=['Barang Masuk','Barang Keluar'];
export const PICS=[...new Set(Object.values(APP_CONFIG.PIC_BY_ROLE))];
export const text=v=>String(v??'').trim();
export const normalize=v=>text(v).toUpperCase().replace(/\s+/g,' ');
export function defaultPic(role){const value=text(role).toLowerCase();return Object.entries(APP_CONFIG.PIC_BY_ROLE).find(([key])=>value.includes(key))?.[1]||APP_CONFIG.PIC_BY_ROLE.inventory;}
export function validateEntries(entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>MAX_ENTRY_ROWS)throw new Error('Isi 1–1000 baris per penyimpanan.');
 return entries.map((row,index)=>{
  const out=Object.fromEntries(['tanggal','from','to','sku','namaBarang','status','pic','keterangan'].map(key=>[key,text(row?.[key])])),qty=Number(row?.qty);
  if(!out.from||!out.to||!out.sku||!out.namaBarang||!Number.isFinite(qty)||qty<=0||qty>Number.MAX_SAFE_INTEGER)throw new Error(`Baris ${index+1}: From, To, SKU, Nama barang, dan Qty > 0 wajib diisi.`);
  if(Object.values(out).some(v=>v.length>250))throw new Error(`Baris ${index+1}: teks terlalu panjang.`);
  // Accept old timestamp drafts during rollout, but all new forms send a date.
  const date=out.tanggal.split('T')[0];
  if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(out.tanggal)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error(`Baris ${index+1}: tanggal tidak valid.`);
  if(!STATUSES.includes(out.status)||!PICS.includes(out.pic))throw new Error(`Baris ${index+1}: Status/PIC tidak valid.`);
  if(!['RECEIPT','PENGELUARAN'].includes(out.keterangan))throw new Error(`Baris ${index+1}: Keterangan tidak valid.`);
  if(out.keterangan!==(out.status==='Barang Masuk'?'RECEIPT':'PENGELUARAN'))throw new Error(`Baris ${index+1}: Keterangan tidak sesuai Status.`);
  return {...out,qty};
 });
}
export const quoteSheet=name=>`'${name.replaceAll("'","''")}'`;
export function selectLedgerSheets(sheets,entries){
 const result={};
 for(const status of new Set(entries.map(r=>r.status))){
  const aliases=status==='Barang Masuk'?['barang masuk']:['barang keluar','barang keiuar'];
  const matches=sheets.filter(s=>aliases.includes(text(s.properties?.title).toLowerCase()));
  if(matches.length!==1)throw new Error(`Tab ${status} tidak ditemukan atau ambigu di Spreadsheet 2026.`);
  result[status]=matches[0].properties;
 }
 return result;
}
export function firstEmptyLedgerRow(values){
 const header=values.findIndex(row=>normalize(row?.[3])==='SKU'&&/NAMA/.test(normalize(row?.[4])));
 if(header<0||header>9)throw new Error('Header ledger tidak sesuai: SKU harus kolom D dan Nama barang kolom E.');
 if(['STATUS','PIC','KETERANGAN'].some((key,i)=>normalize(values[header]?.[i+6])!==key))throw new Error('Header ledger G:I tidak sesuai form input.');
 const expected=['TANGGAL','FROM','TO'];
 if(expected.some((key,index)=>normalize(values[header]?.[index])!==key)||!['QTY','QUANTITY'].includes(normalize(values[header]?.[5])))throw new Error('Header ledger A:F tidak sesuai form input.');
 let row=header+1;while(row<values.length&&values[row].slice(0,6).some(v=>text(v)!==''))row++;
 return row; // zero based; dropdowns/formulas in G:P do not make an otherwise empty entry occupied.
}
export function buildLedgerRequests(sheet,start,entries){
 const values=entries.map(r=>[(Date.parse(r.tanggal.split('T')[0]+'T00:00:00Z')/86400000)+25569,r.from,r.to,r.sku,r.namaBarang,r.qty,r.status,r.pic,r.keterangan]);
 const rowCount=Number(sheet.gridProperties?.rowCount)||0,extra=rowCount?Math.max(0,start+values.length+1-rowCount):0;
 return [
  ...(extra?[{appendDimension:{sheetId:sheet.sheetId,dimension:'ROWS',length:extra}}]:[]),
  // Insert and fill in one atomic Google batch. Concurrent inserts shift existing
  // records instead of overwriting a row another writer has just filled.
  {insertDimension:{range:{sheetId:sheet.sheetId,dimension:'ROWS',startIndex:start,endIndex:start+values.length},inheritFromBefore:rowCount?false:start>0}},
  {updateCells:{start:{sheetId:sheet.sheetId,rowIndex:start,columnIndex:0},rows:values.map(row=>({values:row.map(value=>({userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:value}}))})),fields:'userEnteredValue'}},
  {repeatCell:{range:{sheetId:sheet.sheetId,startRowIndex:start,endRowIndex:start+values.length,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'M/d/yyyy'}}},fields:'userEnteredFormat.numberFormat'}},
 ];
}
