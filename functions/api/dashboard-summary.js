import { getRequestRole } from './_authz.js';
import { loadInventoryCounts } from './_inventory-analytics.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

export async function handleDashboardSummaryRequest({ request, env }) {
  const totalStartedAt = Date.now(), authStartedAt = Date.now();
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  const authMs = Date.now() - authStartedAt;
  try {
    const startedAt = Date.now();
    // Dashboard startup is counts-only. Detailed warning/accuracy analytics have
    // their own endpoints and must never force this route to materialize tables.
    const counts = await loadInventoryCounts(env);
    const summary = { ...counts, totalSku: counts.kartuStok, minusStock: counts.minusStock };
    return json({
      success: true,
      source: 'supabase',
      partial: false,
      unavailableSources: [],
      today: counts.today,
      barangMasukToday: counts.barangMasukHariIni,
      barangKeluarToday: counts.barangKeluarHariIni,
      summary,
      durationMs: Date.now() - startedAt,
      metrics: { authMs, dbMs: Date.now() - startedAt, serializationMs: 0, totalMs: Date.now() - totalStartedAt, returnedRows: 1 },
    });
  } catch (error) {
    console.error('[DashboardSummary]', error?.message || error);
    return json({ success: false, source: 'supabase', message: 'Gagal menghitung ringkasan inventory.' }, 502);
  }
}

export function onRequestGet(context) {
  return handleDashboardSummaryRequest(context);
}
