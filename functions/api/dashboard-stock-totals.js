import {getRequestRole} from './_authz.js';
import {getSecretSupabaseConfig} from './_supabase-config.js';
export function stockTotals(rows){
 const skus=new Map();let totalQty=0;
 for(const row of rows){const sku=String(row.sku??'').normalize('NFKC').trim().toUpperCase();if(!sku)continue;const qty=Number(row.stok_akhir);if(!Number.isFinite(qty))continue;totalQty+=qty;skus.set(sku,(skus.get(sku)||0)+qty);}
 return {activeSku:[...skus.values()].filter(qty=>qty>0).length,totalQty};
}
export async function handleDashboardStockTotals({request,env},dependencies={}){
 const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!await (dependencies.authorize||getRequestRole)(request,env))return json({success:false},401);
 try{const {url,key}=getSecretSupabaseConfig(env),rows=[];
 for(let offset=0;;offset+=1000){const response=await (dependencies.fetch||fetch)(`${url}/rest/v1/inventory_kartu_stok?select=sku,stok_akhir&order=id.asc&offset=${offset}&limit=1000`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)}),batch=await response.json();if(!response.ok||!Array.isArray(batch))throw Error('Unavailable');rows.push(...batch);if(batch.length<1000)break;}
 return json({success:true,...stockTotals(rows)});
 }catch{return json({success:false,message:'Saldo Kartu Stok belum dapat dimuat.'},502);}
}

export const onRequestGet=context=>handleDashboardStockTotals(context);
