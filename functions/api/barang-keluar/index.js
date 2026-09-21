import { getSecretSupabaseConfig } from '../_supabase-config.js';
import { escapeLike, supabaseRows, transactionPage, transactionSort, transactionSummary } from '../_transaction-read.js';
import { buildInventorySearchFilters, normalizeSearchQuery } from '../_inventory-search.js';

const TABLE = 'inventory_barang_keluar';
// Keep reads compatible with the deployed table schema. In particular, synced_at is
// optional metadata and must not make the whole endpoint fail when it is not present.
const COLUMNS = 'tanggal,from_location,to_location,sku,nama_barang,qty,status,pic,keterangan,source_row_number';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;
const ERROR_REASON = 'BARANG_KELUAR_FETCH_FAILED';
const SAFE_ERROR_MESSAGE = 'Gagal membaca data Barang Keluar.';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}


export function mapBarangKeluarRow(row = {}) {
  return {
    tanggal: row.tanggal ?? '',
    from: row.from_location ?? '',
    to: row.to_location ?? '',
    sku: row.sku ?? '',
    namaBarang: row.nama_barang ?? '',
    qty: row.qty ?? 0,
    status: row.status ?? '',
    pic: row.pic ?? '',
    keterangan: row.keterangan ?? '',
    rowNumber: row.source_row_number ?? null,
  };
}

const supabaseGet = supabaseRows;

async function fetchSyncStatus(config) {
  const path = 'inventory_sync_status?select=*&source=eq.barang_keluar&limit=1';
  const { payload } = await supabaseGet(config, path);
  return payload[0] || null;
}

export async function handleBarangKeluarRequest({ request, env }) {
  const startedAt = Date.now();
  console.info('[BarangKeluarAPI] start');
  try {
    const supabaseConfig = getSecretSupabaseConfig(env);
    const authMs = Date.now() - startedAt;
    console.info('[BarangKeluar] authMs', authMs);
    console.info('[BarangKeluarAPI] auth-ok');

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    const filters = [];
    const sku = String(url.searchParams.get('sku') || '').trim();
    const search = normalizeSearchQuery(url.searchParams.get('q'));
    const status = String(url.searchParams.get('status') || '').trim();
    const startDate = String(url.searchParams.get('startDate') || '').trim();
    const endDate = String(url.searchParams.get('endDate') || '').trim();
    const sort = transactionSort(url.searchParams.get('sort'));
    console.info('[BarangKeluarAPI] params', { page, limit, sort: sort.name, hasSearch: Boolean(search), hasDateRange: Boolean(startDate || endDate) });

    if (sku) filters.push(`sku=ilike.${encodeURIComponent(`%${escapeLike(sku)}%`)}`);
    filters.push(...buildInventorySearchFilters(search, ['sku', 'nama_barang', 'from_location', 'to_location']));
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    const filterQuery = filters.length ? `&${filters.join('&')}` : '';

    let rawRows = [];
    let total = 0;
    console.info('[BarangKeluarAPI] query-start');
    const rowsStartedAt = Date.now();
    const result = await transactionPage(supabaseConfig, TABLE, { columns: COLUMNS, filterQuery, startDate, endDate, page, limit, sort: sort.name, bounded: true });
    rawRows = result.rows;
    total = result.total;
    const rowsMs = Date.now() - rowsStartedAt;
    console.info('[BarangKeluar] rowsMs', rowsMs);
    console.info('[BarangKeluar] countMs', 0, '(included in rows query)');
    console.info('[BarangKeluarAPI] query-ok');

    const includeSummary = url.searchParams.get('includeSummary') !== '0';
    let syncStatus = null;
    const summaryStartedAt = Date.now();
    let summary = result.summary;
    if (includeSummary) {
      const metadata = await Promise.allSettled([fetchSyncStatus(supabaseConfig), summary ? Promise.resolve(summary) : transactionSummary(supabaseConfig, TABLE, filterQuery)]);
      if (metadata[0].status === 'fulfilled') syncStatus = metadata[0].value;
      else console.error('[BarangKeluarAPI] sync-status-error', { code: metadata[0].reason?.code, message: metadata[0].reason?.message });
      if (metadata[1].status === 'fulfilled') summary = metadata[1].value;
      else console.error('[BarangKeluarAPI] summary-error', { code: metadata[1].reason?.code, message: metadata[1].reason?.message });
    }
    const summaryMs = Date.now() - summaryStartedAt;
    console.info('[BarangKeluar] summaryMs', summaryMs);
    const rows = rawRows.map(mapBarangKeluarRow);
    const serializationStartedAt = Date.now();
    const columns = ['tanggal', 'from', 'to', 'sku', 'namaBarang', 'qty', 'status', 'pic', 'keterangan'];
    const response = json({
      success: true,
      source: 'supabase',
      table: `public.${TABLE}`,
      sheetName: 'Barang Keluar',
      startRow: 2,
      columns,
      data: rows,
      rows,
      values: rows.map(row => columns.map(key => row[key] ?? '')),
      total,
      ...(summary ? { summary } : {}),
      page,
      limit,
      pageSize: limit,
      hasNext: page * limit < total,
      lastSync: syncStatus?.last_success_at ?? null,
      syncStatus,
      durationMs: Date.now() - startedAt,
    });
    console.info('[BarangKeluar] serializationMs', Date.now() - serializationStartedAt);
    return response;
  } catch (error) {
    console.error('[BarangKeluarAPI] query-error', {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    return json({ success: false, reason: ERROR_REASON, code: error?.code || 'UPSTREAM_QUERY_FAILED', message: SAFE_ERROR_MESSAGE }, 500);
  } finally {
    console.info('[BarangKeluarAPI] totalMs', Date.now() - startedAt);
  }
}

export function onRequestGet(context) {
  return handleBarangKeluarRequest(context);
}
