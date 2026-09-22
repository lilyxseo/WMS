import { getSecretSupabaseConfig } from '../_supabase-config.js';
import { escapeLike, supabaseRows, transactionPage, transactionSort, transactionSummary } from '../_transaction-read.js';
import { buildInventorySearchFilters, normalizeSearchQuery } from '../_inventory-search.js';

const TABLE = 'inventory_barang_masuk';
// Keep reads compatible with the deployed table schema. In particular, synced_at is
// optional metadata and must not make the whole endpoint fail when it is not present.
export const BARANG_MASUK_COLUMNS = Object.freeze(['tanggal', 'from', 'to', 'sku', 'namaBarang', 'qty', 'status', 'pic', 'keterangan', 'no_iseller', 'netsuite', 'keterangan_lainnya', 'lokasi_surat_jalan', 'stockout', 'dokumen']);
const COLUMNS = 'tanggal,from_location,to_location,sku,nama_barang,qty,status,pic,keterangan,no_iseller,netsuite,keterangan_lainnya,lokasi_surat_jalan,stockout,dokumen,source_row_number';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;
const ERROR_REASON = 'BARANG_MASUK_FETCH_FAILED';
const SAFE_ERROR_MESSAGE = 'Gagal membaca data Barang Masuk.';
const PAGE_STATUSES = Object.freeze(['Barang Masuk', 'Movement']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}


export function mapBarangMasukRow(row = {}) {
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
    no_iseller: row.no_iseller ?? '',
    netsuite: row.netsuite ?? '',
    keterangan_lainnya: row.keterangan_lainnya ?? '',
    lokasi_surat_jalan: row.lokasi_surat_jalan ?? '',
    stockout: row.stockout ?? '',
    dokumen: row.dokumen ?? '',
    rowNumber: row.source_row_number ?? null,
  };
}

const supabaseGet = supabaseRows;

async function fetchSyncStatus(config) {
  // The status view has changed over time. Fetch its deployed shape rather than
  // naming optional freshness fields in the select list.
  const path = 'inventory_sync_status?select=*&source=eq.barang_masuk&limit=1';
  const { payload } = await supabaseGet(config, path);
  return payload[0] || null;
}

export async function handleBarangMasukRequest({ request, env }) {
  const startedAt = Date.now();
  console.info('[BarangMasukAPI] start');
  try {
    // Validate the centralized server-only configuration before constructing a query.
    // This endpoint has no additional route-level auth check; keep its existing auth behavior.
    const supabaseConfig = getSecretSupabaseConfig(env);
    const authMs = Date.now() - startedAt;
    console.info('[BarangMasuk] authMs', authMs);
    console.info('[BarangMasukAPI] auth-ok');

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    const filters = [];
    const sku = String(url.searchParams.get('sku') || '').trim();
    const search = normalizeSearchQuery(url.searchParams.get('q'));
    const from = String(url.searchParams.get('from') || '').trim();
    const to = String(url.searchParams.get('to') || '').trim();
    // This page is the inbound ledger, which includes both ordinary receipts
    // and internal stock movements. Never allow arbitrary status values into
    // this route's scope.
    const requestedStatus = String(url.searchParams.get('status') || '').trim();
    const status = PAGE_STATUSES.includes(requestedStatus) ? requestedStatus : '';
    const startDate = String(url.searchParams.get('startDate') || '').trim();
    const endDate = String(url.searchParams.get('endDate') || '').trim();
    const sort = transactionSort(url.searchParams.get('sort'));
    console.info('[BarangMasukAPI] params', { page, limit, sort: sort.name, hasSearch: Boolean(search), hasDateRange: Boolean(startDate || endDate) });

    if (sku) filters.push(`sku=ilike.${encodeURIComponent(`%${escapeLike(sku)}%`)}`);
    filters.push(...buildInventorySearchFilters(search, ['sku', 'nama_barang', 'from_location', 'to_location']));
    if (from) filters.push(`from_location=eq.${encodeURIComponent(from)}`);
    if (to) filters.push(`to_location=eq.${encodeURIComponent(to)}`);
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    else filters.push(`status=in.(${PAGE_STATUSES.map(encodeURIComponent).join(',')})`);
    const filterQuery = filters.length ? `&${filters.join('&')}` : '';

    let rawRows = [];
    let total = 0;
    console.info('[BarangMasukAPI] query-start');
    const rowsStartedAt = Date.now();
    const result = await transactionPage(supabaseConfig, TABLE, { columns: COLUMNS, filterQuery, startDate, endDate, page, limit, sort: sort.name, bounded: true });
    rawRows = result.rows;
    total = result.total;
    const rowsMs = Date.now() - rowsStartedAt;
    console.info('[BarangMasuk] rowsMs', rowsMs);
    console.info('[BarangMasuk] countMs', 0, '(included in rows query)');
    console.info('[BarangMasukAPI] query-ok');

    const includeSummary = url.searchParams.get('includeSummary') !== '0';
    let syncStatus = null;
    const summaryStartedAt = Date.now();
    let summary = result.summary;
    if (includeSummary) {
      const metadata = await Promise.allSettled([fetchSyncStatus(supabaseConfig), summary ? Promise.resolve(summary) : transactionSummary(supabaseConfig, TABLE, filterQuery)]);
      if (metadata[0].status === 'fulfilled') syncStatus = metadata[0].value;
      else console.error('[BarangMasukAPI] sync-status-error', { code: metadata[0].reason?.code, message: metadata[0].reason?.message });
      if (metadata[1].status === 'fulfilled') summary = metadata[1].value;
      else console.error('[BarangMasukAPI] summary-error', { code: metadata[1].reason?.code, message: metadata[1].reason?.message });
    }
    const summaryMs = Date.now() - summaryStartedAt;
    console.info('[BarangMasuk] summaryMs', summaryMs);
    const rows = rawRows.map(mapBarangMasukRow);
    const serializationStartedAt = Date.now();
    const body = {
      success: true,
      source: 'supabase',
      table: `public.${TABLE}`,
      sheetName: 'Barang Masuk',
      startRow: 2,
      columns: BARANG_MASUK_COLUMNS,
      data: rows,
      rows,
      values: rows.map(row => BARANG_MASUK_COLUMNS.map(key => row[key] ?? '')),
      total,
      ...(summary ? { summary } : {}),
      page,
      limit,
      pageSize: limit,
      hasNext: page * limit < total,
      lastSync: syncStatus?.last_success_at ?? null,
      syncStatus,
      durationMs: Date.now() - startedAt,
    };
    const serializationMs = Date.now() - serializationStartedAt;
    console.info('[BarangMasuk] serializationMs', serializationMs);
    return json(body);
  } catch (error) {
    console.error('[BarangMasukAPI] query-error', {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    return json({ success: false, reason: ERROR_REASON, code: error?.code || 'UPSTREAM_QUERY_FAILED', message: SAFE_ERROR_MESSAGE }, 500);
  } finally {
    console.info('[BarangMasukAPI] totalMs', Date.now() - startedAt);
  }
}

export function onRequestGet(context) {
  return handleBarangMasukRequest(context);
}
