import {getGoogleAccessToken} from '../_google-auth.js';
import {getNoteIdentity} from '../_note-identity.js';
import {json} from '../_work-store.js';
import {ASSET_ID} from './rows.js';
import {retryAudit} from '../_audit-retry.js';
export async function handleAssetRead({request,env},{identity=getNoteIdentity,getToken=getGoogleAccessToken,fetchFn=fetch}={}){try{
 if(request.method!=='GET')return json({success:false},405);
 if(!await identity(request,env))return json({success:false,message:'Silakan login kembali.'},401);
 const sheet=new URL(request.url).searchParams.get('sheet');if(sheet!==null&&(!sheet.trim()||sheet.length>100||!sheet.toLowerCase().includes('asset')))return json({success:false,message:'Sheet Asset tidak valid.'},400);
 const token=await getToken(env),base=`https://sheets.googleapis.com/v4/spreadsheets/${ASSET_ID}`;
 const read=path=>retryAudit(async()=>{const response=await fetchFn(base+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});if(!response.ok){const error=Error([403,404].includes(response.status)?'Spreadsheet Asset Store belum dapat diakses oleh Gmail WMS. Bagikan spreadsheet ke akun Gmail WMS.':'Data Asset Store belum dapat dibaca dari Google Sheets. Coba kembali nanti.');error.status=response.status;throw error;}return response.json();});
 const meta=await read('?fields=sheets.properties.title'),sheets=(meta.sheets||[]).filter(item=>String(item.properties?.title||'').toLowerCase().includes('asset'));
 if(sheet===null)return json({success:true,sheets});
 if(!sheets.some(item=>item.properties.title===sheet))return json({success:false,message:'Sheet Asset tidak ditemukan.'},404);
 const range="'"+sheet.replaceAll("'","''")+"'!A1:ZZ",data=await read('/values/'+encodeURIComponent(range));
 return json({success:true,values:Array.isArray(data.values)?data.values:[]});
}catch(error){return json({success:false,message:error.message||'Data Asset Store belum dapat dimuat.'},503);}}
export const onRequest=context=>handleAssetRead(context);
