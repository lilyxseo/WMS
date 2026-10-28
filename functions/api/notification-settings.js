import {getNoteIdentity} from './_note-identity.js';
import {archiveDeveloperRole} from '../../assets/js/archive-source-config.js';
import {normalizeProfilePhone} from './profile.js';
import {workStore,json} from './_work-store.js';
const fields=['phone','phone_number','whatsapp','whatsapp_number','nomor_hp','no_hp','nomor_telepon','nomor_whatsapp','phoneNumber'];
export function notificationPhone(row){try{const field=fields.find(field=>Object.hasOwn(row,field)),value=field?row[field]:'';const phone=normalizeProfilePhone(value);return /^62\d{8,13}$/.test(phone)?phone:'';}catch{return '';}}
export async function handleNotificationSettings({request,env},dependencies={}){try{
 const store=dependencies.store||workStore;
 const actor=await (dependencies.identity||getNoteIdentity)(request,env);if(!actor)return json({success:false},401);if(!archiveDeveloperRole(actor.role))return json({success:false},403);
 if(!['GET','PATCH'].includes(request.method))return json({success:false},405);
 if(request.method==='PATCH'){
  const body=await request.json();if(!body||typeof body.user_id!=='string'||typeof body.warning_enabled!=='boolean'||typeof body.bot_enabled!=='boolean'||Object.keys(body).some(key=>!['user_id','warning_enabled','bot_enabled'].includes(key)))return json({success:false,message:'Pengaturan tidak valid.'},400);
  const {data:users}=await store(env,'users?'+new URLSearchParams({select:'*',id:'eq.'+body.user_id,limit:'1'}));if(!users?.length)return json({success:false},404);
  if((body.warning_enabled||body.bot_enabled)&&!notificationPhone(users[0]))return json({success:false,message:'User harus mengisi nomor WhatsApp di profil terlebih dahulu.'},400);
  await store(env,'notification_user_settings?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({...body,updated_by:actor.id,updated_at:new Date().toISOString()})});
  await store(env,'rpc/notification_cancel_revoked',{method:'POST',body:'{}'});
  return json({success:true});
 }
 const users=[],preferences=[];
 for(const [table,target] of [['users',users],['notification_user_settings',preferences]])for(let offset=0;;offset+=1000){const {data}=await store(env,table+'?'+new URLSearchParams({select:'*',order:table==='users'?'id.asc':'user_id.asc',offset:String(offset),limit:'1000'}));if(!Array.isArray(data))throw Error();target.push(...data);if(data.length<1000)break;}
 return json({success:true,users:users.map(user=>{const pref=preferences.find(pref=>pref.user_id===String(user.id)),phone=notificationPhone(user);return {id:String(user.id),name:String(user.full_name||user.username||'User'),username:String(user.username||''),phone,warning_enabled:!!phone&&!!pref?.warning_enabled,bot_enabled:!!phone&&!!pref?.bot_enabled};})});
}catch{return json({success:false,message:'Pengaturan notifikasi belum tersedia. Periksa konfigurasi database.'},503);}}

export const onRequest=context=>handleNotificationSettings(context);
