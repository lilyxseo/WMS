import {getRequestRole} from '../_authz.js';
import {getSecretSupabaseConfig} from '../_supabase-config.js';
import {supabaseRows} from '../_transaction-read.js';
import {buildInventorySearchQuery} from '../_inventory-search.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function onRequestGet({request,env}){
 if(!await getRequestRole(request,env))return json({success:false,message:'Sesi tidak valid.'},401);
 const query=String(new URL(request.url).searchParams.get('q')||'').trim();
 if(query.length<2||query.length>200)return json({success:false,message:'Masukkan 2–200 karakter SKU, nama, atau lokasi.'},400);
 try{
  const config=getSecretSupabaseConfig(env),base='inventory_kartu_stok?select=sku,nama_barang,lokasi_bulky,stok_akhir&stok_akhir=neq.0&order=source_row_number.asc&limit=80';
  let {payload}=await supabaseRows(config,base+'&sku=eq.'+encodeURIComponent(query),{signal:AbortSignal.timeout(8000)});
  if(!payload.length)({payload}=await supabaseRows(config,base+buildInventorySearchQuery(query,['sku','nama_barang','lokasi_bulky']),{signal:AbortSignal.timeout(8000)}));
  const rows=payload.map(row=>({sku:String(row.sku??''),nama:String(row.nama_barang||'-'),lokasi:String(row.lokasi_bulky||'-'),stok_akhir:Number(row.stok_akhir)})).filter(row=>row.sku&&Number.isFinite(row.stok_akhir)&&row.stok_akhir!==0);
  return json({success:true,rows});
 }catch{return json({success:false,message:'Pencarian stok belum dapat dimuat. Coba lagi.'},502);}
}
