import {getSecretSupabaseConfig} from './_supabase-config.js';
const STOCK=['kartu_stok','rpl','bulky'];
export function mutationSyncSources(request){if(!['POST','PATCH','PUT','DELETE'].includes(request.method))return [];const path=new URL(request.url).pathname;
 if(/^\/api\/barang-masuk(?:\/|$)/.test(path))return ['barang_masuk',...STOCK];
 if(/^\/api\/barang-keluar(?:\/|$)/.test(path))return ['barang_keluar',...STOCK];
 if(/^\/api\/movement(?:\/|$)/.test(path)||path==='/api/stock-entry')return ['barang_masuk','barang_keluar',...STOCK];return [];}
export async function requestInventoryRefresh(env,sources,fetchFn=fetch){try{const {url,key}=getSecretSupabaseConfig(env),res=await fetchFn(url+'/rest/v1/rpc/request_inventory_refresh',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_sources:sources}),signal:AbortSignal.timeout(8000)});if(!res.ok)throw Error('Queue unavailable');return true;}catch{console.warn('[InventoryRefresh] Deferred to scheduled synchronization');return false;}}
