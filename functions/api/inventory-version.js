import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

const SOURCES = Object.freeze({
  barangMasukVersion: 'inventory_barang_masuk',
  barangKeluarVersion: 'inventory_barang_keluar',
  kartuStokVersion: 'inventory_kartu_stok',
  rplVersion: 'inventory_rpl',
  bulkyVersion: 'inventory_bulky',
  netsuiteVersion: 'netsuite',
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

export async function handleInventoryVersionRequest({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try {
    const config = getSecretSupabaseConfig(env);
    const response=await fetch(`${config.url}/rest/v1/rpc/inventory_client_versions`,{method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
    let versions=await response.json();if(!response.ok&&versions?.code==='PGRST202'){const fallback=await fetch(`${config.url}/rest/v1/inventory_sync_status?select=source,source_version`,{headers:{apikey:config.key,Authorization:`Bearer ${config.key}`},signal:AbortSignal.timeout(10000)}),rows=await fallback.json();if(!fallback.ok||!Array.isArray(rows))throw Error('Version metadata unavailable');const names={barangMasukVersion:'barang_masuk',barangKeluarVersion:'barang_keluar',kartuStokVersion:'kartu_stok',rplVersion:'rpl',bulkyVersion:'bulky',netsuiteVersion:'netsuite'};return json({...Object.fromEntries(Object.entries(names).map(([key,source])=>[key,rows.find(row=>row.source===source)?.source_version||'unsynced'])),updatedAt:new Date().toISOString()});}if(!response.ok||!versions||Array.isArray(versions)||Object.keys(SOURCES).some(key=>typeof versions[key]!=='string'))throw Error('Inventory versions unavailable');
    return json(versions);
  } catch (error) {
    console.error('[InventoryVersion]', error?.message || error);
    return json({ success: false, message: 'Gagal memuat versi inventory.' }, 502);
  }
}

export function onRequestGet(context) {
  return handleInventoryVersionRequest(context);
}
