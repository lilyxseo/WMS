import { getRequestRole } from './_authz.js';
import { readWarningSnapshot } from './_warning-snapshot.js';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
export async function onRequestGet({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try { const url = new URL(request.url), result = await readWarningSnapshot(env, Object.fromEntries(url.searchParams)); return json({ success: true, source: 'supabase', ...result }); }
  catch (error) {
    console.error('[InventoryWarnings]', error?.message || error, error?.failures || '');
    return json({ success: false, message: error?.message||'Hasil pemeriksaan server belum tersedia.', unavailableSources: (error?.failures || []).map(item => item.source) }, 502);
  }
}
