import {getRequestRole} from './_authz.js';
import {getGoogleAccessToken} from './_google-auth.js';
import {archiveDb,configuredArchives,archiveSpreadsheetId} from './_archive-sources.js';
import {readSkuTables,readCount1Tables,sheetColumn,sheetSku} from './_advance-sheet-data.js';
import {buildHeaderInfo} from './balikan-store/_utils.js';
import {parseBalikanSheet} from './balikan-store/_parse-sheet.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const normalized=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
export async function resolveAdvanceSpreadsheet(kind,env,list=archiveDb){
 const archives=configuredArchives(env);
 if(kind==='ledger2025')return archives.find(item=>item.key==='kartu-stok-2025').spreadsheetId;
 if(kind==='so2025'||kind==='trips')return archives.find(item=>item.key==='inventory').spreadsheetId;
 if(kind==='so2026'){
  if(env.SO_2026_SPREADSHEET_ID)return archiveSpreadsheetId(env.SO_2026_SPREADSHEET_ID);
  const matches=(await list(env,'?select=spreadsheet_id,name')).filter(row=>normalized(row.name)==='so2026');
  if(matches.length!==1)throw Error('Spreadsheet SO 2026 belum terdaftar atau ambigu di Arsip. Daftarkan dengan nama SO 2026 atau atur SO_2026_SPREADSHEET_ID.');
  return archiveSpreadsheetId(matches[0].spreadsheet_id);
 }
 throw Error('Sumber tidak dikenal.');
}
export async function handleAdvanceSources({request,env},dependencies={}){
 if(!await (dependencies.authorize||getRequestRole)(request,env))return json({success:false,message:'Sesi tidak valid'},401);
 const params=new URL(request.url).searchParams,kind=params.get('source'),sku=String(params.get('sku')||'').trim();
 if(!['ledger2025','so2025','so2026','trips'].includes(kind)||!sku||sku.length>200)return json({success:false,message:'Sumber dan SKU wajib valid.'},400);
 try{
  const id=await resolveAdvanceSpreadsheet(kind,env,dependencies.archives),token=await (dependencies.getToken||getGoogleAccessToken)(env),fetchFn=dependencies.fetch||fetch;
  const google=async path=>{const response=await fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(40000)}),data=await response.json();if(!response.ok)throw Error('Sumber belum dapat dibaca. Periksa akses Gmail WMS ke spreadsheet.');return data;};
  const meta=await google('?fields=sheets.properties'),all=(meta.sheets||[]).map(item=>item.properties);
  let selected;
  if(kind==='ledger2025')selected=['barangmasuk','barangkeluar'].map(name=>{const matches=all.filter(item=>normalized(item.title).replace('barangkeiuar','barangkeluar')===name);if(matches.length!==1)throw Error('Tab Barang Masuk/Keluar 2025 tidak ditemukan atau ambigu.');return matches[0];});
  else if(kind==='so2025'||kind==='so2026'){const title=kind==='so2025'?'sojuli2025':'count1';selected=all.filter(item=>normalized(item.title)===title);if(selected.length!==1)throw Error('Tab '+(kind==='so2025'?'SO JULI 2025':'COUNT 1')+' tidak ditemukan atau ambigu.');}
  else {selected=all.filter(item=>String(item.title).toUpperCase().includes('TRIP'));if(!selected.length)throw Error('Tidak ada sheet TRIP yang dapat dibaca.');}
  const groups=[],failures=[];let cursor=0;
  async function worker(){while(cursor<selected.length){const start=cursor;cursor+=8;const sheets=selected.slice(start,start+8),query=new URLSearchParams();
   for(const sheet of sheets){const columns=sheet.gridProperties?.columnCount;if(!Number.isInteger(columns)||columns<1||columns>18278)throw Error('Ukuran kolom sheet belum dapat diverifikasi.');query.append('ranges',`'${sheet.title.replaceAll("'","''")}'!A1:${sheetColumn(columns-1)}`);}
   const data=await google('/values:batchGet?'+query);if(data.valueRanges?.length!==sheets.length)throw Error('Respons sumber tidak lengkap.');
   sheets.forEach((sheet,index)=>{try{
    const values=data.valueRanges[index].values||[];
    if(kind==='trips'){
     const parsed=parseBalikanSheet(values),headerInfo=buildHeaderInfo(values),labels=Object.fromEntries(parsed.dynamicColumns.map(column=>[column.key,column.header]));
     for(const row of parsed.rows){const raw=values[row.rowNumber-1]||[];for(const [field,column] of Object.entries(headerInfo.columnMap))row[field]=['checked'].includes(field)?raw[column]??'':String(raw[column]??'').trim();for(const key of Object.keys(labels)){const column=Number(key.replace('extra_',''));row[key]=raw[column]??'';}}
     const rows=parsed.rows.filter(row=>sheetSku(row.sku)===sheetSku(sku)).map(row=>{const result={'Sumber Sheet':sheet.title};for(const [key,value] of Object.entries(row)){const label=labels[key]||key;result[Object.hasOwn(result,label)?`${label} (${key})`:label]=value;}return result;});
     groups.push({name:`Balikan Store · ${sheet.title}`,rows});
    }else if(kind==='so2026')groups.push(...readCount1Tables(values,sku,{sheetName:sheet.title}));
    else groups.push(...readSkuTables(values,sku,{sheetName:sheet.title,sourceName:kind==='ledger2025'?'Kartu Stok 2025':kind==='so2025'?'Stok Opname 2025':'Stok Opname 2026'}));
   }catch(error){failures.push({sheet:sheet.title,message:error.message});}});
  }}
  await Promise.all([worker(),worker()]);
  if(!groups.length)throw Error(failures[0]?.message||'Sumber belum dapat dibaca.');
  groups.sort((a,b)=>a.name.localeCompare(b.name,'id',{numeric:true}));
  const resultGroups=kind==='trips'?[{name:'Balikan Store · Semua TRIP',rows:groups.flatMap(group=>group.rows)}]:groups;
  return json({success:true,groups:resultGroups,failures,partial:failures.length>0});
 }catch(error){return json({success:false,message:error.message||'Sumber tambahan belum dapat dimuat.'},503);}
}
export const onRequestGet=context=>handleAdvanceSources(context);
