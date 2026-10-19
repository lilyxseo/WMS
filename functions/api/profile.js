import {getNoteIdentity} from './_note-identity.js';
import {getSecretSupabaseConfig} from './_supabase-config.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const PHONE_FIELDS=['phone','phone_number','whatsapp','whatsapp_number','nomor_hp','no_hp','nomor_telepon','nomor_whatsapp','phoneNumber'];
export function normalizeProfilePhone(value){
 let phone=String(value??'').trim();if(!phone)return '';
 if(!/^\+?[\d\s()-]+$/.test(phone))throw Error('Nomor WhatsApp tidak valid.');
 phone=phone.replace(/\D/g,'');if(phone.startsWith('0'))phone='62'+phone.slice(1);else if(phone.startsWith('8'))phone='62'+phone;
 if(!/^[1-9]\d{7,14}$/.test(phone))throw Error('Gunakan nomor WhatsApp lengkap, misalnya 6281234567890.');return phone;
}
export async function onRequest({request,env}){
 if(!['GET','PATCH'].includes(request.method))return json({success:false,message:'Method not allowed'},405);
 try{
  const identity=await getNoteIdentity(request,env);if(!identity)return json({success:false,message:'Silakan login kembali.'},401);
  if(identity.id.startsWith('developer:'))return json({success:false,message:'Akun developer sementara tidak memiliki profil pribadi. Gunakan akun pengguna terdaftar.'},403);
  const {url,key}=getSecretSupabaseConfig(env),headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  async function query(params,options={}){const res=await fetch(`${url}/rest/v1/users?${params}`,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(15000)});const data=await res.json().catch(()=>null);if(!res.ok){const error=Error(data?.code==='23505'?'Username atau nomor WhatsApp sudah digunakan.':'Profil gagal disimpan atau dimuat. Coba lagi.');error.status=data?.code==='23505'?409:502;throw error;}return data;}
  const where=new URLSearchParams({id:`eq.${identity.id}`,select:'*',limit:'1'});
  const rows=await query(where),profile=rows?.[0];if(!profile)return json({success:false,message:'Profil belum tersedia. Hubungi administrator.'},404);
  const phoneField=PHONE_FIELDS.find(field=>Object.hasOwn(profile,field));
  const view=row=>({id:identity.id,full_name:String(row.full_name||''),username:String(row.username||''),email:String(row.email||''),role:String(row.role||identity.role||''),phone:phoneField?String(row[phoneField]||''):'',phoneAvailable:!!phoneField});
  if(request.method==='GET')return json({success:true,profile:view(profile)});
  const body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['full_name','username','phone'].includes(key)))return json({success:false,message:'Hanya nama, username dan nomor WhatsApp yang bisa diubah.'},400);
  const update={};
  for(const field of ['full_name','username'])if(Object.hasOwn(body,field)){
   if(typeof body[field]!=='string'||body[field].trim().length>100||!body[field].trim()||/[\u0000-\u001f]/.test(body[field]))return json({success:false,message:'Nama dan username wajib diisi, maksimal 100 karakter.'},400);
   if(field==='username'&&/\s/.test(body[field].trim()))return json({success:false,message:'Username tidak boleh mengandung spasi.'},400);
   update[field]=body[field].trim();
  }
  if(Object.hasOwn(body,'phone')){
   if(!phoneField)return json({success:false,message:'Kolom nomor WhatsApp belum tersedia. Hubungi administrator.'},400);
   let phone;try{phone=normalizeProfilePhone(body.phone);}catch(error){return json({success:false,message:error.message},400);}
   if(phone){
    const variants=[phone,'+'+phone,...(phone.startsWith('62')?['0'+phone.slice(2),phone.slice(2)]:[])];
    const matches=await query(new URLSearchParams({select:'id',[phoneField]:`in.(${variants.join(',')})`,id:`neq.${identity.id}`,limit:'1'}));
    if(matches?.length)return json({success:false,message:'Nomor WhatsApp sudah digunakan akun lain.'},409);
   }
   update[phoneField]=phone||null;
  }
  if(!Object.keys(update).length)return json({success:false,message:'Tidak ada perubahan.'},400);
  const saved=await query(new URLSearchParams({id:`eq.${identity.id}`,select:'*'}),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(update)});
  if(!saved?.[0])return json({success:false,message:'Profil tidak ditemukan.'},404);
  return json({success:true,profile:view(saved[0])});
 }catch(error){return json({success:false,message:error.status?error.message:'Tidak dapat mengakses profil. Coba lagi nanti.'},error.status||502);}
}
