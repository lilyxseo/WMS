import {getSecretSupabaseConfig} from './_supabase-config.js';
const key=value=>String(value??'').trim().toUpperCase();
const inFilter=values=>`in.(${values.map(value=>`"${String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`).join(',')})`;
export async function fetchSkuNoteNames(env,skus){
 const requested=[...new Set(skus.map(key).filter(Boolean))];if(!requested.length)return {};
 const config=getSecretSupabaseConfig(env),names={};
 // Prefer current stock names, then fall back for SKUs no longer in Kartu Stok.
 for(const table of ['inventory_kartu_stok','inventory_rpl','inventory_bulky','inventory_barang_masuk','inventory_barang_keluar']){
  const missing=requested.filter(sku=>!names[sku]);if(!missing.length)break;
  try{
   for(let offset=0;;offset+=1000){
    const params=new URLSearchParams({select:'sku,nama_barang',sku:inFilter(missing),order:'source_row_number.asc',limit:'1000',offset:String(offset)});
    const response=await fetch(`${config.url}/rest/v1/${table}?${params}`,{headers:{apikey:config.key,Authorization:`Bearer ${config.key}`}});
    if(!response.ok)throw new Error('Name lookup unavailable');const rows=await response.json();if(!Array.isArray(rows))throw new Error('Invalid name lookup');
    for(const row of rows){const sku=key(row.sku),name=String(row.nama_barang??'').trim();if(missing.includes(sku)&&name&&!names[sku])names[sku]=name;}
    if(rows.length<1000||missing.every(sku=>names[sku]))break;
   }
  }catch{console.warn('[SkuNotes] Item name lookup unavailable',{source:table});}
 }
 return names;
}
