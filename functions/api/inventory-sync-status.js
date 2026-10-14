import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleInventorySyncStatusRequest({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);

  try {
    const { url, key } = getSecretSupabaseConfig(env);
    const allSources=new URL(request.url).searchParams.get('all')==='1';
    const query=allSources?'select=source,status,last_success_at,locked_at&order=source.asc':'select=*&last_success_at=not.is.null&order=last_success_at.desc&limit=1';
    const response = await fetch(`${url}/rest/v1/inventory_sync_status?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const rows = await response.json().catch(() => null);
    if (!response.ok) throw new Error(rows?.message || `Supabase HTTP ${response.status}`);
    if(!Array.isArray(rows))throw new Error('Invalid sync status response');
    const publicRows=allSources?rows.map(({source,status,last_success_at,locked_at})=>({source,status,last_success_at,locked_at})):rows;
    const syncStatus = allSources?[...publicRows].filter(row=>row.last_success_at).sort((a,b)=>String(b.last_success_at).localeCompare(String(a.last_success_at)))[0]||null:rows[0]||null;
    return json({ success: true, source: 'public.inventory_sync_status', syncStatus, ...(allSources?{sources:publicRows}:{}), last_success_at: syncStatus?.last_success_at ?? null });
  } catch (error) {
    console.error('[InventorySyncStatus]', error?.message || error);
    return json({ success: false, message: 'Gagal memuat status sinkronisasi inventory.' }, 502);
  }
}

export function onRequestGet(context) {
  return handleInventorySyncStatusRequest(context);
}
