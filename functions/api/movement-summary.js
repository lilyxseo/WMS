import { getSecretSupabaseConfig } from './_supabase-config.js';
import { exactTotal, supabaseRows } from './_transaction-read.js';

const TABLE = 'inventory_barang_masuk';
const MOVEMENT_STATUS = 'Movement';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleMovementSummaryRequest({ env }) {
  try {
    const config = getSecretSupabaseConfig(env);
    // ilike without wildcards is an exact, case-insensitive match. Asking for no
    // rows keeps this endpoint scalar while PostgREST returns the exact count.
    const path = `${TABLE}?select=status&status=ilike.${encodeURIComponent(MOVEMENT_STATUS)}&limit=0`;
    const { response } = await supabaseRows(config, path, { count: true });
    return json({
      success: true,
      source: 'supabase',
      table: `public.${TABLE}`,
      status: MOVEMENT_STATUS,
      totalMovement: exactTotal(response, 0),
    });
  } catch (error) {
    console.error('[MovementSummaryAPI]', error?.message || error);
    return json({ success: false, message: 'Gagal menghitung Total Movement.' }, 502);
  }
}

export function onRequestGet(context) {
  return handleMovementSummaryRequest(context);
}
