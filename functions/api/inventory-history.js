import {getRequestRole} from './_authz.js';
import {getGoogleAccessToken} from './_google-auth.js';
import {businessDateKey} from './_inventory-analytics.js';
import {downloadInventoryRevision,findInventoryRevision,RevisionUnavailable} from './_inventory-drive-revisions.js';
import {readInventoryRevision} from './_inventory-revision-xlsx.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const datasets=new Set(['stock','rpl','bulky','inbound','outbound']);
const dayMs=86400000;

function validDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
 const parsed=new Date(value+'T00:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}

export async function handleInventoryHistory({request,env},{
 authorize=getRequestRole,getToken=getGoogleAccessToken,fetchFn=fetch,readWorkbook=readInventoryRevision
}={}){
 if(!await authorize(request,env))return json({success:false,message:'Silakan login kembali.'},401);
 const params=new URL(request.url).searchParams,today=businessDateKey();
 const day=params.get('date')??today,kind=params.get('kind')||'stock';
 if(!validDate(day)||day>today||!datasets.has(kind))return json({success:false,message:'Tanggal atau sumber riwayat tidak valid.'},400);
 const sheetId=String(env.SHEET_ID_2026||env.GOOGLE_SHEET_ID||'').trim();
 if(!/^[\w-]{20,}$/.test(sheetId))return json({success:false,message:'Spreadsheet gudang belum dikonfigurasi.'},503);
 const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page'),10)||1));
 const query=(params.get('q')||'').trim().slice(0,120);
 const unavailable=message=>json({success:true,date:day,latestDate:today,revisionUnavailable:true,message,rows:[],total:0,page:1});
 try{
  const token=await getToken(env);
  const cutoff=Date.parse(day+'T00:00:00+07:00')+dayMs;
  const revision=await findInventoryRevision(fetchFn,sheetId,token,cutoff);
  if(!revision)return unavailable('Tidak ada versi Google Sheets yang tersedia sampai akhir tanggal ini.');
  const workbook=await downloadInventoryRevision(fetchFn,sheetId,revision.id,token);
  const result=await readWorkbook(workbook,{kind,query,page});
  if(!result)return unavailable('Tab atau header sumber tidak ditemukan pada versi spreadsheet ini.');
  return json({success:true,date:day,latestDate:today,revisionAt:revision.modifiedTime,page,...result});
 }catch(error){
  if(error instanceof RevisionUnavailable)return unavailable(error.message);
  return json({success:false,message:'Versi lama spreadsheet belum dapat dibaca. Coba lagi.'},503);
 }
}
export const onRequestGet=context=>handleInventoryHistory(context);
