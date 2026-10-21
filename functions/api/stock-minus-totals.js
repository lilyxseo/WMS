import {getRequestRole} from './_authz.js';
import {getSecretSupabaseConfig} from './_supabase-config.js';
import {supabaseRows,escapeLike} from './_transaction-read.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const key=value=>String(value??'').normalize('NFKC').trim().toUpperCase();
export async function readSkuTotals(config,table,skus){
 const filter='('+skus.map(sku=>'sku.ilike."'+escapeLike(sku).replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',')+')',totals=new Map();
 for(let offset=0;;offset+=1000){const params=new URLSearchParams({select:'sku,qty',or:filter,order:'source_row_number.asc',limit:'1000',offset:String(offset)}),{payload}=await supabaseRows(config,table+'?'+params);
  for(const row of payload){const sku=key(row.sku),qty=Number(row.qty??0);if(!Number.isFinite(qty))throw Error('Qty riwayat tidak valid.');totals.set(sku,(totals.get(sku)||0)+Math.abs(qty));}if(payload.length<1000)break;
 }return totals;
}
export async function onRequestPost({request,env}){try{
 if(!await getRequestRole(request,env))return json({success:false,message:'Silakan login kembali.'},401);
 const body=await request.json().catch(()=>null);if(!Array.isArray(body?.skus)||!body.skus.length||body.skus.length>50||body.skus.some(sku=>typeof sku!=='string'||!sku.trim()||sku.length>150))return json({success:false,message:'Isi 1–50 SKU valid.'},400);
 const skus=[...new Set(body.skus.map(sku=>sku.trim()))],config=getSecretSupabaseConfig(env),[masuk,keluar]=await Promise.all([readSkuTotals(config,'inventory_barang_masuk',skus),readSkuTotals(config,'inventory_barang_keluar',skus)]);
 return json({success:true,items:skus.map(sku=>({sku,totalMasuk:masuk.get(key(sku))||0,totalKeluar:keluar.get(key(sku))||0}))});
 }catch{return json({success:false,message:'Total riwayat belum dapat dimuat. Muat ulang Stok Minus untuk mencoba kembali.'},503);}}
