import { getRequestRole } from './_authz.js';
import { readWarningSnapshot } from './_warning-snapshot.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=30' } });
}

export async function onRequestGet({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try {
    const result=await readWarningSnapshot(env,{limit:1});
    return json({success:true,source:'supabase',summary:{...result.summary,warningCount:result.summary.total},partial:result.partial,checkedAt:result.checkedAt,snapshotStale:result.snapshotStale});
  } catch (error) {
    console.error('[InventoryWarningSummary]', error?.message || error);
    return json({ success: false, source: 'supabase', message: 'Gagal menghitung warning inventory.' }, 502);
  }
}
