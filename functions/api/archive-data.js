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
 const range="'"+title.replaceAll("'","''")+"'!A1:"+archiveColumnName(count),data=await archiveGoogle(env,id,'/values/'+encodeURIComponent(range));return json({success:true,values:data.values||[]});
 }catch(error){return json({success:false,message:error.message||'Arsip belum dapat dibaca.'},503);}}
