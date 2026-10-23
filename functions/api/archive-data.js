import {archiveDeveloperRole} from '../../assets/js/archive-source-config.js';
import {requestInventoryRefresh} from './_sync-refresh.js';
import {getNoteIdentity} from './_note-identity.js';
import {json,archiveSpreadsheetId,registeredArchive,archiveGoogle} from './_archive-sources.js';
export function archiveColumnName(index){let result='';while(index>0){index--;result=String.fromCharCode(65+index%26)+result;index=Math.floor(index/26);}return result;}
export async function onRequestGet({request,env}){try{
 if(!await getNoteIdentity(request,env))return json({success:false,message:'Silakan login kembali.'},401);
 const params=new URL(request.url).searchParams;let id;try{id=archiveSpreadsheetId(params.get('spreadsheetId'));}catch(error){return json({success:false,message:error.message},400);}
 if(!await registeredArchive(env,id))return json({success:false,message:'Spreadsheet belum terdaftar di Arsip.'},404);
 const meta=await archiveGoogle(env,id,'?fields=sheets.properties'),sheets=(meta.sheets||[]).map(sheet=>sheet.properties),title=params.get('sheet');
 if(!title)return json({success:true,sheets:sheets.map(sheet=>({key:sheet.title,name:sheet.title,spreadsheetId:id}))});
 const sheet=sheets.find(sheet=>sheet.title===title);if(!sheet)return json({success:false,message:'Sheet tidak ditemukan.'},404);
 const count=Number(sheet.gridProperties?.columnCount);if(!Number.isInteger(count)||count<1||count>18278)throw Error('Ukuran sheet belum dapat dibaca.');
 const range="'"+title.replaceAll("'","''")+"'!A1:"+archiveColumnName(count),data=await archiveGoogle(env,id,'/values/'+encodeURIComponent(range));const raw=await archiveGoogle(env,id,'/values/'+encodeURIComponent(range)+'?valueRenderOption=FORMULA&dateTimeRenderOption=FORMATTED_STRING');return json({success:true,values:data.values||[],formulaValues:raw.values||[],gridProperties:sheet.gridProperties});
 }catch(error){return json({success:false,message:error.message||'Arsip belum dapat dibaca.'},503);}}

export function validateArchiveEdits(edits,sheet){
 if(!Array.isArray(edits)||!edits.length||edits.length>1000)throw Error('Gunakan 1–1000 perubahan sel per penyimpanan.');
 const {rowCount,columnCount}=sheet.gridProperties||{};if(!Number.isInteger(rowCount)||!Number.isInteger(columnCount)||rowCount<1||columnCount<1)throw Error('Ukuran sheet belum dapat diverifikasi.');
 const seen=new Set();return edits.map(edit=>{const {row,column,value,before}=edit||{};
 if(!Number.isInteger(row)||row<1||row>sheet.gridProperties?.rowCount||!Number.isInteger(column)||column<1||column>sheet.gridProperties?.columnCount)throw Error('Alamat sel di luar ukuran sheet.');
 if(typeof value!=='string'||value.length>10000||!['string','number','boolean'].includes(typeof before))throw Error('Nilai atau snapshot sel tidak valid.');
 const address=archiveColumnName(column)+row;if(seen.has(address))throw Error('Alamat sel duplikat.');seen.add(address);
 return {address,value,before:String(before)};
 });
}
export async function onRequestPost({request,env,waitUntil}){try{
 const identity=await getNoteIdentity(request,env);if(!identity)return json({success:false,message:'Silakan login kembali.'},401);
 if(!archiveDeveloperRole(identity.role)&&!/^pic(?:\s|$)/i.test(identity.role))return json({success:false,message:'Akses read-only. Hanya PIC atau Developer yang bisa mengubah data.'},403);
 let body;try{body=await request.json();}catch{return json({success:false,message:'Data perubahan tidak valid.'},400);}
 let id;try{id=archiveSpreadsheetId(body.spreadsheetId);}catch(error){return json({success:false,message:error.message},400);}
 if(!await registeredArchive(env,id))return json({success:false,message:'Spreadsheet belum terdaftar di Arsip.'},404);
 const meta=await archiveGoogle(env,id,'?fields=sheets.properties'),sheet=(meta.sheets||[]).map(item=>item.properties).find(item=>item.title===body.sheet);
 if(!sheet)return json({success:false,message:'Sheet tidak ditemukan.'},404);
 let edits;try{edits=validateArchiveEdits(body.edits,sheet);}catch(error){return json({success:false,message:error.message},400);}
 const prefix="'"+sheet.title.replaceAll("'","''")+"'!";
 // Compare raw values/formulas before a single batched write; never overwrite a stale draft silently.
 for(let offset=0;offset<edits.length;offset+=100){const chunk=edits.slice(offset,offset+100),params=new URLSearchParams({valueRenderOption:'FORMULA',dateTimeRenderOption:'FORMATTED_STRING'});chunk.forEach(edit=>params.append('ranges',prefix+edit.address));
  const current=await archiveGoogle(env,id,'/values:batchGet?'+params);
  if(current.valueRanges?.length!==chunk.length)throw Error('Snapshot sheet belum dapat diverifikasi.');
  if(chunk.some((edit,index)=>String(current.valueRanges[index]?.values?.[0]?.[0]??'')!==edit.before))return json({success:false,message:'Sel berubah di spreadsheet. Muat ulang Arsip dan periksa draf sebelum menyimpan.',code:'ARCHIVE_CELL_CONFLICT'},409);
 }
 const result=await archiveGoogle(env,id,'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'USER_ENTERED',includeValuesInResponse:true,responseValueRenderOption:'FORMATTED_VALUE',data:edits.map(edit=>({range:prefix+edit.address,values:[[edit.value]]}))})});
 if(result.responses?.length!==edits.length)throw Error('Penyimpanan belum terkonfirmasi. Periksa spreadsheet sebelum mengulang.');
 if([env.SHEET_ID_INVENTORY,env.SHEET_ID_2026].includes(id)){const task=requestInventoryRefresh(env,['barang_masuk','barang_keluar','kartu_stok','rpl','bulky','netsuite']);if(waitUntil)waitUntil(task);else await task;}
 return json({success:true,cells:edits.map((edit,index)=>({address:edit.address,value:result.responses[index]?.updatedData?.values?.[0]?.[0]??edit.value}))});
 }catch(error){return json({success:false,message:error.message||'Penyimpanan Arsip belum terkonfirmasi. Periksa spreadsheet sebelum mengulang.'},503);}}
