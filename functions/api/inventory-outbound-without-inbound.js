import { getRequestRole } from './_authz.js';
import { loadOutboundWithoutInbound } from './_outbound-without-inbound.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

export async function onRequestGet({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try {
    const rows = await loadOutboundWithoutInbound(env);
    return json({ success: true, source: 'supabase', statusScope: ['Barang Masuk', 'Movement'], count: rows.length, rows });
  } catch (error) {
    console.error('[OutboundWithoutInbound]', error?.message || error);
    return json({ success: false, source: 'supabase', message: 'Gagal menghitung SKU keluar tanpa data masuk.' }, 502);
  }
}
