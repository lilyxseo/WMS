import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

const BARCODE_TABLE = 'inventory_barcode';
const BARCODE_COLUMNS = 'barcode,sku';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function normalizedBarcode(value) {
  return String(value || '').trim();
}

function diagnostic(message, details) {
  if (details === undefined) console.info(`[BarcodeLookup] ${message}`);
  else console.info(`[BarcodeLookup] ${message}`, details);
}

export async function handleBarcodeLookupRequest({ request, env }) {
  const startedAt = Date.now();
  diagnostic('request received');
  try {
    const role = await getRequestRole(request, env);
    if (!role) {
      diagnostic('error code/message', { code: 'UNAUTHORIZED', message: 'Invalid or missing session' });
      return json({ success: false, error: 'UNAUTHORIZED' }, 401);
    }
    diagnostic('auth ok');

    const barcode = normalizedBarcode(new URL(request.url).searchParams.get('barcode'));
    if (!barcode || barcode.length > 128) {
      diagnostic('error code/message', { code: 'INVALID_BARCODE', message: 'Barcode is missing or too long' });
      return json({ success: false, error: 'INVALID_BARCODE' }, 400);
    }
    diagnostic('normalized barcode');

    const config = getSecretSupabaseConfig(env);
    const query = new URL(`${config.url}/rest/v1/${BARCODE_TABLE}`);
    query.searchParams.set('select', BARCODE_COLUMNS);
    query.searchParams.set('barcode', `eq.${barcode}`);
    query.searchParams.set('limit', '1');
    diagnostic('db query start');
    const response = await fetch(query, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || `Supabase HTTP ${response.status}`);
      error.code = payload?.code || 'SUPABASE_QUERY_FAILED';
      throw error;
    }
    const rows = Array.isArray(payload) ? payload : [];
    diagnostic('db query result count', { count: rows.length });
    const sku = String(rows[0]?.sku || '').trim();
    return sku ? json({ success: true, found: true, sku }) : json({ success: true, found: false });
  } catch (error) {
    console.error('[BarcodeLookup] error code/message', {
      code: String(error?.code || 'BARCODE_LOOKUP_FAILED'),
      message: String(error?.message || 'Unknown error'),
    });
    return json({ success: false, error: 'BARCODE_LOOKUP_FAILED' }, 500);
  } finally {
    diagnostic('totalMs', { totalMs: Date.now() - startedAt });
  }
}

export function onRequestGet(context) {
  return handleBarcodeLookupRequest(context);
}
