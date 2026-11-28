import {getRequestRole} from './_authz.js';
import {businessDateKey} from './_inventory-analytics.js';
import {getSecretSupabaseConfig} from './_supabase-config.js';

const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const datasets = new Set(['stock','rpl','bulky','inbound','outbound']);

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===value;
}

export async function handleInventoryHistory({request,env},{authorize=getRequestRole,fetchFn=fetch}={}) {
  if (!await authorize(request,env)) return json({success:false,message:'Silakan login kembali.'},401);
  const params = new URL(request.url).searchParams;
  const day = params.get('date'), kind = params.get('kind') || 'stock';
  if ((day!==null&&(!validDate(day)||day>businessDateKey()))||!datasets.has(kind))return json({success:false,message:'Tanggal atau sumber riwayat tidak valid.'},400);
  const page = Math.max(1,Math.min(100000,Number.parseInt(params.get('page'),10)||1));
  const query = (params.get('q')||'').trim().slice(0,120);
  try{
    const {url,key}=getSecretSupabaseConfig(env);
    const response=await fetchFn(url+'/rest/v1/rpc/read_inventory_daily_history',{
      method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(12000),body:JSON.stringify({p_date:day,p_kind:kind,p_query:query,p_page:page})
    });
    const data=await response.json();
    if(!response.ok||!Array.isArray(data?.rows))throw Error();
    return json({success:true,...data});
  }catch{
    return json({success:false,message:'Riwayat gudang belum dapat dibaca. Coba lagi.'},503);
  }
}
export const onRequestGet=context=>handleInventoryHistory(context);
