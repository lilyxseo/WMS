import { getRequestRole } from '../_authz.js';
import { getSecretSupabaseConfig } from '../_supabase-config.js';
import { buildInventorySearchFilters, normalizeSearchQuery } from '../_inventory-search.js';

const TABLE = 'inventory_kartu_stok';
const COLUMNS = 'lokasi_bulky,sku,nama_barang,stok_awal,internal_stock_transfer,replenishment,pengeluaran,stok_akhir,source_row_number,synced_at';
const MAX_PAGE_SIZE = 100;
const FULL_BATCH_SIZE = 1000;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function serverCredentials(env) {
  return getSecretSupabaseConfig(env);
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, match => `\\${match}`);
}

export function mapKartuStokRow(row = {}) {
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
    source_row_number: row.source_row_number ?? null,
    synced_at: row.synced_at ?? null,
  };
}

async function supabaseGet(env, path, { count = false } = {}) {
  const { url, key } = serverCredentials(env);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(count ? { Prefer: 'count=exact' } : {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Supabase HTTP ${response.status}`);
  return { payload: Array.isArray(payload) ? payload : [], response };
}

async function fetchSyncStatus(env) {
  // Query the deployed view shape. Optional freshness columns have differed
  // between schema revisions, so enumerating them can break the entire read.
  const query = 'inventory_sync_status?select=*&source=eq.kartu_stok&limit=1';
  const { payload } = await supabaseGet(env, query);
  return payload[0] || null;
}

export async function handleKartuStokRequest({ request, env }) {
  const role = await getRequestRole(request, env);
  if (!role) return json({ success: false, message: 'Sesi tidak valid untuk membaca Kartu Stok' }, 401);

  try {
    const startedAt = Date.now();
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'page';
    const search = normalizeSearchQuery(url.searchParams.get('search') || url.searchParams.get('q'));
    const sku = String(url.searchParams.get('sku') || '').trim();
    const lokasi = String(url.searchParams.get('lokasi') || '').trim();
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const filters = [];
    if (sku) filters.push(`sku=ilike.${encodeURIComponent(`%${escapeLike(sku)}%`)}`);
    if (lokasi) filters.push(...buildInventorySearchFilters(lokasi, ['lokasi_bulky']));
    filters.push(...buildInventorySearchFilters(search, ['sku', 'nama_barang', 'lokasi_bulky']));
    const filterQuery = filters.length ? `&${filters.join('&')}` : '';
    let rawRows = [];
    let total = 0;

    if (mode === 'full') {
      for (let offset = 0; ; offset += FULL_BATCH_SIZE) {
        const { payload, response } = await supabaseGet(env, `${TABLE}?select=${COLUMNS}${filterQuery}&order=source_row_number.asc&offset=${offset}&limit=${FULL_BATCH_SIZE}`, { count: offset === 0 });
        rawRows.push(...payload);
        if (offset === 0) total = Number(String(response.headers.get('content-range') || '').split('/')[1]) || payload.length;
        if (payload.length < FULL_BATCH_SIZE) break;
      }
    } else {
      const offset = (page - 1) * pageSize;
      const { payload, response } = await supabaseGet(env, `${TABLE}?select=${COLUMNS}${filterQuery}&order=source_row_number.asc&offset=${offset}&limit=${pageSize}`, { count: true });
      rawRows = payload;
      total = Number(String(response.headers.get('content-range') || '').split('/')[1]) || payload.length;
    }

    const syncStatus = await fetchSyncStatus(env);
    const data = rawRows.map(mapKartuStokRow);
    return json({ success: true, source: 'supabase', table: `public.${TABLE}`, data, rows: data, total, page, pageSize: mode === 'full' ? data.length : pageSize, syncStatus, durationMs: Date.now() - startedAt });
  } catch (error) {
    console.error('[KartuStokSupabase]', error?.message || error);
    return json({ success: false, source: 'supabase', message: `Gagal membaca Kartu Stok dari Supabase: ${error?.message || 'Unknown error'}` }, 502);
  }
}

export function onRequestGet(context) {
  return handleKartuStokRequest(context);
}
