import {getSecretSupabaseConfig} from '../_supabase-config.js';
import {getNoteIdentity} from '../_note-identity.js';
const columns='id,sku,body,author_name,author_role,created_at';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const skuKey=value=>typeof value==='string'?value.trim().toUpperCase():'';
const validSku=sku=>sku.length>0&&sku.length<=200;
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
async function database(env,params,options={}){
 const config=getSecretSupabaseConfig(env);
 const response=await fetch(`${config.url}/rest/v1/sku_notes?${params}`,{...options,headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json',...(options.headers||{})}});
 if(!response.ok)throw new Error('Notes database unavailable');
 return response.json();
}
export async function onRequestGet({request,env}){
 try{
  const viewer=await getNoteIdentity(request,env);
  if(!viewer)return json({success:false,message:'Sesi tidak valid. Silakan login kembali.'},401);
  const url=new URL(request.url),sku=skuKey(url.searchParams.get('sku'));
  if(!validSku(sku))return json({success:false,message:'SKU wajib diisi.'},400);
  const page=Math.max(1,Math.min(100000,parseInt(url.searchParams.get('page'),10)||1));
  const params=new URLSearchParams({select:`${columns},author_id`,sku:`eq.${sku}`,order:'created_at.desc,id.desc',offset:String((page-1)*20),limit:'21'});
  const rows=await database(env,params);
  return json({success:true,rows:rows.slice(0,20).map(({author_id,...note})=>({...note,canDelete:author_id===viewer.id})),page,hasNext:rows.length>20});
 }catch{return json({success:false,message:'Catatan belum dapat dimuat. Coba lagi.'},503);}
}
export async function onRequestPost({request,env}){
 try{
  const author=await getNoteIdentity(request,env);
  if(!author)return json({success:false,message:'Sesi tidak valid. Silakan login kembali.'},401);
  let input;try{input=await request.json();}catch{return json({success:false,message:'Data catatan tidak valid.'},400);}
  const sku=skuKey(input?.sku),body=typeof input?.body==='string'?input.body.trim():'';
  if(!validSku(sku)||!body||body.length>2000||!validId(input?.id))return json({success:false,message:'Isi catatan wajib diisi, maksimal 2.000 karakter.'},400);
  const params=new URLSearchParams({select:columns,on_conflict:'id'});
  const rows=await database(env,params,{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id:input.id,sku,body,author_id:author.id,author_name:author.name,author_role:author.role})});
  if(rows.length)return json({success:true,note:rows[0]},201);
  const existing=await database(env,new URLSearchParams({select:columns,id:`eq.${input.id}`,author_id:`eq.${author.id}`,sku:`eq.${sku}`,limit:'1'}));
  if(!existing.length||existing[0].body!==body)return json({success:false,message:'Catatan berubah. Muat ulang daftar sebelum mencoba lagi.'},409);
  return json({success:true,note:existing[0]});
 }catch{return json({success:false,message:'Penyimpanan belum terkonfirmasi. Teks tetap tersedia; coba kembali untuk catatan yang sama.'},503);}
}

export async function onRequestDelete({request,env}){
 try{
  const author=await getNoteIdentity(request,env);
  if(!author)return json({success:false,message:'Sesi tidak valid. Silakan login kembali.'},401);
  let input;try{input=await request.json();}catch{return json({success:false,message:'Data catatan tidak valid.'},400);}
  const sku=skuKey(input?.sku);
  if(!validSku(sku)||!validId(input?.id))return json({success:false,message:'SKU atau catatan tidak valid.'},400);
  // Apply ownership in the deletion itself: no client role, name, or author ID
  // can broaden this filter, including Developer accounts.
  const params=new URLSearchParams({select:'id',id:`eq.${input.id}`,sku:`eq.${sku}`,author_id:`eq.${author.id}`});
  const rows=await database(env,params,{method:'DELETE',headers:{Prefer:'return=representation'}});
  if(!rows.length)return json({success:false,message:'Catatan tidak ditemukan atau bukan milik Anda.'},404);
  return json({success:true,id:rows[0].id});
 }catch{return json({success:false,message:'Penghapusan belum terkonfirmasi. Refresh Catatan sebelum mencoba lagi.'},503);}
}
