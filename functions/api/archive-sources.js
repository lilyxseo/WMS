import {getNoteIdentity} from './_note-identity.js';
import {json,archiveDb,archiveGoogle,archiveSpreadsheetId,archiveDeveloperRole,BUILTIN_ARCHIVE_SOURCES,archiveItem,configuredArchives} from './_archive-sources.js';
export async function onRequestGet({request,env}){try{const who=await getNoteIdentity(request,env);if(!who)return json({success:false,message:'Silakan login kembali.'},401);const rows=await archiveDb(env,'?select=spreadsheet_id,name,created_at&order=created_at.asc');return json({success:true,items:rows.map(archiveItem),builtins:configuredArchives(env),canManage:archiveDeveloperRole(who.role)});}catch{return json({success:false,message:'Daftar spreadsheet Arsip belum dapat dimuat.'},503);}}
export async function onRequestPost({request,env}){try{
 const who=await getNoteIdentity(request,env);if(!who)return json({success:false,message:'Silakan login kembali.'},401);if(!archiveDeveloperRole(who.role))return json({success:false,message:'Hanya Developer yang dapat mengelola spreadsheet Arsip.'},403);
 const body=await request.json().catch(()=>null);let id;try{id=archiveSpreadsheetId(body?.spreadsheetId);}catch(error){return json({success:false,message:error.message},400);}
 if(configuredArchives(env).some(source=>source.spreadsheetId===id))return json({success:false,message:'Spreadsheet ini sudah tersedia sebagai Arsip bawaan.'},409);
 const requested=String(body?.name??'').trim();if(requested.length>120)return json({success:false,message:'Nama maksimal 120 karakter.'},400);
 const meta=await archiveGoogle(env,id,'?fields=properties.title,sheets.properties.title'),name=requested||String(meta.properties?.title||'Spreadsheet Arsip').slice(0,120);
 const rows=await archiveDb(env,'',{method:'POST',body:JSON.stringify({spreadsheet_id:id,name,created_by:who.id})});return json({success:true,item:archiveItem(rows[0]),sheetCount:meta.sheets?.length||0},201);
 }catch(error){return json({success:false,message:error.message||'Spreadsheet belum disimpan.'},error.status||503);}}
export async function onRequestDelete({request,env}){try{
 const who=await getNoteIdentity(request,env);if(!who)return json({success:false,message:'Silakan login kembali.'},401);if(!archiveDeveloperRole(who.role))return json({success:false,message:'Hanya Developer yang dapat mengelola spreadsheet Arsip.'},403);
 let id;try{id=archiveSpreadsheetId(new URL(request.url).searchParams.get('spreadsheetId'));}catch(error){return json({success:false,message:error.message},400);}
 await archiveDb(env,'?'+new URLSearchParams({spreadsheet_id:'eq.'+id}),{method:'DELETE'});return json({success:true});
 }catch(error){return json({success:false,message:error.message||'Spreadsheet belum dilepas.'},503);}}
