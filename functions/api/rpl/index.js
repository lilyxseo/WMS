import { getSecretSupabaseConfig } from '../_supabase-config.js';
import { buildInventorySearchFilters, normalizeSearchQuery } from '../_inventory-search.js';

const TABLE = 'inventory_rpl';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const FULL_BATCH_SIZE = 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, match => `\\${match}`);
}

export function mapRplRow(row = {}) {
  const hasNetsuite = row.netsuite !== null && row.netsuite !== undefined;
  return {
    lokasi: row.lokasi_bulky ?? '',
    'lokasi bulky': row.lokasi_bulky ?? '',
    sku: row.sku ?? '',
    'nama barang': row.nama_barang ?? '',
    'stok awal': row.stok_awal ?? 0,
    'internal stock transfer': row.internal_stock_transfer ?? 0,
    replenishment: row.replenishment ?? 0,
    pengeluaran: row.pengeluaran ?? 0,
    'stok akhir': row.stok_akhir ?? 0,
    netsuite: hasNetsuite ? row.netsuite : null,
    // Preserve the established accuracy difference while using NETSUITE as
    // its reference. Missing reference data remains missing, never zero.
    selisih: hasNetsuite ? Number(row.stok_akhir ?? 0) - Number(row.netsuite) : null,
    source_row_number: row.source_row_number ?? null,
    synced_at: row.synced_at ?? null,
  };
}

async function supabaseGet(config, path, { count = false } = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      ...(count ? { Prefer: 'count=exact' } : {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Supabase HTTP ${response.status}`);
  if (!Array.isArray(payload)) throw new TypeError('Supabase returned an invalid response body');
  return { payload, response };
}

function exactTotal(response, fallback) {
  const total = String(response.headers.get('content-range') || '').split('/')[1];
  return total && total !== '*' ? Number(total) : fallback;
}

async function fetchSyncStatus(config) {
  const { payload } = await supabaseGet(config, 'inventory_sync_status?select=*&source=eq.rpl&limit=1');
  return payload[0] || null;
}

export async function handleRplRequest({ request, env }) {
  const startedAt = Date.now();
  try {
    const config = getSecretSupabaseConfig(env);
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'page';
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    const sku = String(url.searchParams.get('sku') || '').trim();
    const search = normalizeSearchQuery(url.searchParams.get('q'));
    const lokasi = String(url.searchParams.get('lokasi') || '').trim();
    const filters = [];
    if (sku) filters.push(`sku=ilike.${encodeURIComponent(`%${escapeLike(sku)}%`)}`);
    filters.push(...buildInventorySearchFilters(search, ['sku', 'nama_barang', 'lokasi_bulky']));
    if (lokasi) filters.push(...buildInventorySearchFilters(lokasi, ['lokasi_bulky']));
    const filterQuery = filters.length ? `&${filters.join('&')}` : '';

    let rawRows = [];
    let total = 0;
    if (mode === 'full') {
      for (let offset = 0; ; offset += FULL_BATCH_SIZE) {
        const result = await supabaseGet(config, `${TABLE}?select=*${filterQuery}&order=source_row_number.asc&offset=${offset}&limit=${FULL_BATCH_SIZE}`, { count: offset === 0 });
        rawRows.push(...result.payload);
        if (offset === 0) total = exactTotal(result.response, result.payload.length);
        if (result.payload.length < FULL_BATCH_SIZE || (total > 0 && rawRows.length >= total)) break;
      }
    } else {
      const offset = (page - 1) * limit;
      const result = await supabaseGet(config, `${TABLE}?select=*${filterQuery}&order=source_row_number.asc&offset=${offset}&limit=${limit}`, { count: true });
      rawRows = result.payload;
      total = exactTotal(result.response, result.payload.length);
    }

    const syncStatus = await fetchSyncStatus(config);
    const rows = rawRows.map(mapRplRow);
    return json({
      success: true,
      source: 'supabase',
      table: `public.${TABLE}`,
      sheetName: 'RPL',
      data: rows,
      rows,
      total,
      page,
      limit: mode === 'full' ? rows.length : limit,
      pageSize: mode === 'full' ? rows.length : limit,
      lastSync: syncStatus?.last_success_at ?? null,
      syncStatus,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[RplAPI] Supabase query failed', error?.message || error);
    return json({
      success: false,
      source: 'supabase',
      reason: 'RPL_FETCH_FAILED',
      message: `Gagal membaca data RPL dari Supabase: ${error?.message || 'Unknown error'}`,
    }, 500);
  }
}

export function onRequestGet(context) {
  return handleRplRequest(context);
}
