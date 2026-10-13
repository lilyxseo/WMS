import {fetchSkuNoteNames} from '../_sku-note-names.js';
import {getSecretSupabaseConfig} from '../_supabase-config.js';
import {getNoteIdentity} from '../_note-identity.js';
const columns='id,sku,body,author_name,author_role,created_at';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const skuKey=value=>typeof value==='string'?value.trim().toUpperCase():'';
const validSku=sku=>sku.length>0&&sku.length<=200;
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
async function database(env,params,options={}){
 const {count=false,...fetchOptions}=options;
 const config=getSecretSupabaseConfig(env);
 const response=await fetch(`${config.url}/rest/v1/sku_notes?${params}`,{...fetchOptions,headers:{...(count?{Prefer:'count=exact'}:{}),apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json',...(options.headers||{})}});
 if(!response.ok)throw new Error('Notes database unavailable');
 const rows=await response.json();
 if(!count)return rows;
 const rawTotal=String(response.headers.get('content-range')||'').split('/')[1];
 return {rows,total:/^\d+$/.test(rawTotal||'')?Number(rawTotal):null};
}
export async function onRequestGet({request,env}){
 try{
  const viewer=await getNoteIdentity(request,env);
  if(!viewer)return json({success:false,message:'Sesi tidak valid. Silakan login kembali.'},401);
  const url=new URL(request.url),sku=skuKey(url.searchParams.get('sku'));
  const all=url.searchParams.get('all')==='1';
  if(!all&&!validSku(sku))return json({success:false,message:'SKU wajib diisi.'},400);
  const page=Math.max(1,Math.min(100000,parseInt(url.searchParams.get('page'),10)||1));
  const params=new URLSearchParams({select:`${columns},author_id`,sku:`eq.${sku}`,order:'created_at.desc,id.desc',offset:String((page-1)*20),limit:'21'});
  if(all){
   params.delete('sku');
   if(url.searchParams.get('mine')==='1')params.set('author_id',`eq.${viewer.id}`);
   const query=String(url.searchParams.get('q')||'').trim();
   if(query.length>150)return json({success:false,message:'Pencarian maksimal 150 karakter.'},400);
   if(query){
    const value=query.replace(/[\\%_]/g,char=>'\\'+char);
    const pattern=`%${value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}%`;
    params.set('or','('+['sku','body','author_name','author_role'].map(field=>`${field}.ilike."${pattern}"`).join(',')+')');
   }
  }
  const result=await database(env,params,{count:all});
  const rows=all?result.rows:result;
  const visible=rows.slice(0,20);
  const names=all?await fetchSkuNoteNames(env,visible.map(note=>note.sku)):{};
  return json({success:true,rows:visible.map(({author_id,...note})=>({...note,canDelete:author_id===viewer.id,...(all?{namaBarang:names[String(note.sku).trim().toUpperCase()]||''}:{})})),page,hasNext:rows.length>20,...(all?{total:result.total}:{})});
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
