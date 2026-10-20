import {getRequestRole} from './_authz.js';
import {getSecretSupabaseConfig} from './_supabase-config.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function handleInventoryAccuracy({request,env},dependencies={}){
 if(!await (dependencies.authorize||getRequestRole)(request,env))return json({success:false,message:'Sesi tidak valid'},401);
 try{
  const {url,key}=getSecretSupabaseConfig(env),response=await (dependencies.fetch||fetch)(`${url}/rest/v1/rpc/inventory_netsuite_accuracy`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}'}),data=await response.json();
  if(!response.ok||!Array.isArray(data?.rows))throw Error('ACCURACY_UNAVAILABLE');
  return json({success:true,...data});
 }catch{return json({success:false,message:'Perbandingan Kartu Stok dan NetSuite belum tersedia. Pastikan kedua sumber berhasil disinkronkan.'},502);}
}
export const onRequestGet=context=>handleInventoryAccuracy(context);
