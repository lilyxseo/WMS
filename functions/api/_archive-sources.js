import {BUILTIN_ARCHIVE_SOURCES} from '../../assets/js/archive-source-config.js';
import {getSecretSupabaseConfig} from './_supabase-config.js';
import {getGoogleAccessToken} from './_google-auth.js';
export {archiveSpreadsheetId,archiveDeveloperRole,BUILTIN_ARCHIVE_SOURCES} from '../../assets/js/archive-source-config.js';
export const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function archiveDb(env,query='',options={}){
 const {url,key}=getSecretSupabaseConfig(env),response=await fetch(url+'/rest/v1/archive_spreadsheets'+query,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'},signal:AbortSignal.timeout(15000)}),data=await response.json().catch(()=>null);
 if(!response.ok){const error=Error(response.status===409?'Spreadsheet sudah terdaftar.':'Daftar spreadsheet Arsip belum dapat diakses.');error.status=response.status===409?409:503;throw error;}if(!Array.isArray(data))throw Error('Respons daftar Arsip tidak valid.');return data;
}
export async function archiveGoogle(env,id,path){
 const token=await getGoogleAccessToken(env),response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(40000)}),data=await response.json().catch(()=>null);
 if(!response.ok||!data)throw Error(response.status===403||response.status===404?'Spreadsheet tidak ditemukan atau Gmail WMS belum memiliki akses. Bagikan spreadsheet ke akun Gmail WMS terlebih dahulu.':'Google Sheets belum dapat dibaca. Coba kembali nanti.');return data;
}
export const registeredArchive=async(env,id)=>configuredArchives(env).find(source=>source.spreadsheetId===id)||(await archiveDb(env,'?'+new URLSearchParams({select:'spreadsheet_id,name',spreadsheet_id:'eq.'+id,limit:'1'})))[0]||null;
export const archiveItem=row=>({key:'registered:'+row.spreadsheet_id,name:row.name,spreadsheetId:row.spreadsheet_id,registered:true,createdAt:row.created_at});

export function configuredArchives(env){const sources=BUILTIN_ARCHIVE_SOURCES.map(item=>({...item,builtin:true}));const inventory=String(env.SHEET_ID_INVENTORY||'').trim();if(inventory)sources[0]={...sources[0],spreadsheetId:inventory,registered:true};const current=String(env.SHEET_ID_2026||'').trim();if(current)sources.push({key:'kartu-stok-2026',name:'Kartu Stok 2026',spreadsheetId:current,builtin:true,registered:true});return sources.filter((source,index,all)=>all.findIndex(other=>other.spreadsheetId===source.spreadsheetId)===index);}
