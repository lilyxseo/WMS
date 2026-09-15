import { getRequestRole } from '../_authz.js';
import { loadTotalMovement } from '../_inventory-analytics.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleMovementSummaryRequest({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try {
    const totalMovement = await loadTotalMovement(env);
    return json({ success: true, source: 'supabase', table: 'public.inventory_barang_masuk', status: 'Movement', totalMovement });
  } catch (error) {
    console.error('[MovementSummary]', error?.message || error);
    return json({ success: false, message: 'Gagal menghitung Total Movement.' }, 502);
  }
}

export function onRequestGet(context) {
  return handleMovementSummaryRequest(context);
}
