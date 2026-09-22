import { getRequestRole } from '../_authz.js';
import { getSecretSupabaseConfig } from '../_supabase-config.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function escaped(value) {
  return JSON.stringify(String(value ?? '')).slice(1, -1);
}

function addEscapedRepresentations(result) {
  const decorate = side => ({
    ...side,
    escapedRawSkuValues: (side?.rawSkuValues || []).map(escaped),
  });
  return {
    ...result,
    escapedRequestedSku: escaped(result?.sku),
    barangMasuk: decorate(result?.barangMasuk),
    barangKeluar: decorate(result?.barangKeluar),
  };
}

export async function onRequestGet({ request, env }) {
  const role = String(await getRequestRole(request, env) || '').trim().toLowerCase();
  if (!role.includes('developer') && !role.includes('admin')) {
    return json({ success: false, message: 'Akses developer/admin diperlukan.' }, 403);
  }
  const sku = new URL(request.url).searchParams.get('sku');
  if (sku === null || !String(sku).trim()) return json({ success: false, message: 'Parameter sku wajib diisi.' }, 400);
  try {
    const config = getSecretSupabaseConfig(env);
    const response = await fetch(`${config.url}/rest/v1/rpc/inventory_sku_presence_debug`, {
      method: 'POST',
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_sku: sku }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || `Supabase diagnostic RPC failed (${response.status})`);
    return json({ success: true, source: 'supabase', ...addEscapedRepresentations(result) });
  } catch (error) {
    console.error('[InventorySkuPresenceDebug]', error?.message || error);
    return json({ success: false, source: 'supabase', message: 'Gagal memeriksa keberadaan SKU.' }, 502);
  }
}
