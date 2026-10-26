import {getGoogleAccessToken} from './_google-auth.js';
import {buildHeaderInfo,escSheet} from './balikan-store/_utils.js';
import {FIELD_MAP,BARANG_KELUAR_FIELD_MAP,SHEET_BARANG_MASUK,SHEET_BARANG_KELUAR} from './_barang-ops.js';
const columnIndex=letter=>[...letter].reduce((value,char)=>value*26+char.charCodeAt(0)-64,0)-1;
const columnName=index=>{let value='';for(index++;index>0;index=Math.floor((index-1)/26))value=String.fromCharCode(65+(index-1)%26)+value;return value;};
const scalar=value=>value==null?'':typeof value==='boolean'||typeof value==='number'?value:String(value);
function staticConfiguration(env,path){
 if(/^\/api\/barang-(masuk|keluar)(?:\/|$)/.test(path)){const out=path.startsWith('/api/barang-keluar');return {id:env.SHEET_ID_2026,sheet:out?SHEET_BARANG_KELUAR:SHEET_BARANG_MASUK,map:Object.fromEntries(Object.entries(out?BARANG_KELUAR_FIELD_MAP:FIELD_MAP).map(([field,column])=>[field,columnIndex(column)])),sku:3,name:4};}
 if(path==='/api/movement/cell')return {id:env.SHEET_ID_INVENTORY,sheet:'Movement',map:{tanggal:0,from:1,to:2,stokDiLokasiAwal:5,stokAktual:6},sku:3,name:4};
 if(path==='/api/cycle-count/cell')return {id:env.SHEET_ID_INVENTORY,sheet:'Cycle Count',map:{tanggal:0,lokasi:1,sku:2,nama:3,stok:4,aktual:5,catatan:6},sku:2,name:3};
 return null;
}
export function requestedRowEdits(request,body){const path=new URL(request.url).pathname;const row=Number(body.rowNumber||(/\/(\d+)$/.exec(path)?.[1]));const updates=body.updates||(body.field?{[body.field]:body.value}:path.endsWith('/check')?{checked:body.checked===true}:{});
 const rows=Array.isArray(body.edits)?body.edits:Array.isArray(body.rowNumbers)?body.rowNumbers.map(rowNumber=>({rowNumber,updates})):[{rowNumber:row,updates}];
 return rows.filter(edit=>Number.isInteger(Number(edit?.rowNumber))&&Number(edit.rowNumber)>1).slice(0,1000).map(edit=>({rowNumber:Number(edit.rowNumber),updates:edit.updates&&typeof edit.updates==='object'?edit.updates:updates}));
}
export async function captureOperationChanges(env,request,body){
 const path=new URL(request.url).pathname,isBalikan=/^\/api\/balikan-store\/(bulk-update|cell|check)$/.test(path),deleting=request.method==='DELETE'||path.endsWith('/bulk-delete');let config=staticConfiguration(env,path);
 if(!config&&!isBalikan)return null;
 if(isBalikan&&Array.isArray(body.edits)&&body.edits.length>1000)throw Error('Maksimal 1000 baris per perubahan agar seluruh log tercatat.');
 const edits=requestedRowEdits(request,body);if(!edits.length)return null;
 if(isBalikan)config={id:env.SHEET_ID_INVENTORY,sheet:String(body.sheetName||'').trim()};if(!config.id||!config.sheet){if(isBalikan)throw Error('Sumber Balikan Store belum terverifikasi.');return null;}
 const token=await getGoogleAccessToken(env),base=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.id)}`;
 async function read(path){const response=await fetch(base+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)}),data=await response.json().catch(()=>null);if(!response.ok||!data)throw Error('Nilai sebelum perubahan belum dapat dibaca. Data belum diubah.');return data;}
 let headerValues=null;
 if(isBalikan){headerValues=(await read('/values/'+encodeURIComponent(`${escSheet(config.sheet)}!A1:ZZ10`))).values||[];const info=buildHeaderInfo(headerValues);if(!info)throw Error('Header Balikan Store belum dapat diverifikasi untuk pencatatan perubahan.');const headers=headerValues[info.headerRowIndex]||[],map={};for(const field of ['qty','rakTujuan','lokasi','stokBulky','stokRetail','status','keterangan','checked'])if(info.columnMap[field]!==undefined)map[field]=info.columnMap[field];const occupied=new Set(Object.values(info.columnMap));headers.forEach((header,index)=>{if(String(header??'').trim()&&!occupied.has(index))map['extra_'+index]=index;});config={...config,map,sku:info.columnMap.sku,name:info.columnMap.namaBarang};}
 const width=Math.max(config.sku,config.name,...Object.values(config.map))+1,numbers=[...new Set(edits.map(edit=>edit.rowNumber))],rows=new Map();
 for(let offset=0;offset<numbers.length;offset+=50){const batch=numbers.slice(offset,offset+50),query=new URLSearchParams();batch.forEach(row=>query.append('ranges',`${escSheet(config.sheet)}!A${row}:${columnName(width-1)}${row}`));const data=await read('/values:batchGet?'+query);if(data.valueRanges?.length!==batch.length)throw Error('Snapshot baris belum lengkap. Data belum diubah.');batch.forEach((row,index)=>rows.set(row,data.valueRanges[index]?.values?.[0]||[]));}
 const changes=[],seen=new Set();
 for(const edit of edits){const row=rows.get(edit.rowNumber);if(isBalikan&&(!String(row[config.sku]??'').trim()||!String(row[config.name]??'').trim()))throw Error('SKU dan nama barang pada baris tujuan belum dapat diverifikasi. Data belum diubah.');const updates=deleting?{__rowDeleted:''}:edit.updates;for(const [field,input] of Object.entries(updates)){if(changes.length>=1000)throw Error('Maksimal 1000 sel per perubahan.');if(!deleting&&config.map[field]===undefined)continue;const key=edit.rowNumber+':'+field;if(seen.has(key))continue;seen.add(key);let value=input;if(isBalikan&&field==='lokasi'&&typeof value==='string'){try{value=decodeURIComponent(value).trim();}catch{value=value.trim();}}
 const oldValue=deleting?'Baris tersimpan':scalar(row[config.map[field]]),newValue=deleting?'Baris dihapus':scalar(value);if(!deleting&&String(oldValue)===String(newValue))continue;
 changes.push({sku:String(row[config.sku]??''),namaBarang:String(row[config.name]??''),sheet:config.sheet,rowNumber:edit.rowNumber,field,oldValue,newValue,beforeSource:'GOOGLE_SHEETS',status:'PENDING'});
 }}
 return {token,headerValues,changes};
}
export function finalizeOperationChanges(changes,status,failed=[]){return (changes||[]).map(change=>({...change,status:failed.some(item=>Number(item.rowNumber)===change.rowNumber&&(!item.field||item.field===change.field))?'FAILED':status==='SUCCESS'||status==='PARTIAL'?'APPLIED':status==='FAILED'||status==='DENIED'?'FAILED':'UNCERTAIN'}));}
