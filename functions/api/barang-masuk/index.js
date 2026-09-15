import { getSecretSupabaseConfig } from '../_supabase-config.js';
import { escapeLike, supabaseRows, transactionPage, transactionSummary } from '../_transaction-read.js';

const TABLE = 'inventory_barang_masuk';
// Keep reads compatible with the deployed table schema. In particular, synced_at is
// optional metadata and must not make the whole endpoint fail when it is not present.
const COLUMNS = 'tanggal,from_location,to_location,sku,nama_barang,qty,status,pic,keterangan,source_row_number';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;
const ERROR_REASON = 'BARANG_MASUK_FETCH_FAILED';
const SAFE_ERROR_MESSAGE = 'Gagal membaca data Barang Masuk.';

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
    from_location: row.from_location ?? '',
    to: row.to_location ?? '',
    to_location: row.to_location ?? '',
    sku: row.sku ?? '',
    namaBarang: row.nama_barang ?? '',
    nama_barang: row.nama_barang ?? '',
    qty: row.qty ?? 0,
    status: row.status ?? '',
    pic: row.pic ?? '',
    keterangan: row.keterangan ?? '',
    rowNumber: row.source_row_number ?? null,
    source_row_number: row.source_row_number ?? null,
    synced_at: row.synced_at ?? null,
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
    const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'page';
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    const filters = [];
    const sku = String(url.searchParams.get('sku') || '').trim();
    const search = String(url.searchParams.get('q') || '').trim();
    const from = String(url.searchParams.get('from') || '').trim();
    const to = String(url.searchParams.get('to') || '').trim();
    const status = String(url.searchParams.get('status') || '').trim();
    const startDate = String(url.searchParams.get('startDate') || '').trim();
    const endDate = String(url.searchParams.get('endDate') || '').trim();

    if (sku) filters.push(`sku=ilike.${encodeURIComponent(`%${escapeLike(sku)}%`)}`);
    if (search) {
      const term = encodeURIComponent(`*${escapeLike(search)}*`);
      filters.push(`or=(sku.ilike.${term},nama_barang.ilike.${term})`);
    }
    if (from) filters.push(`from_location=eq.${encodeURIComponent(from)}`);
    if (to) filters.push(`to_location=eq.${encodeURIComponent(to)}`);
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    const filterQuery = filters.length ? `&${filters.join('&')}` : '';

    let rawRows = [];
    let total = 0;
    console.info('[BarangMasukAPI] query-start');
    const direction = url.searchParams.get('sort') === 'oldest' ? 'asc' : 'desc';
    const rowsStartedAt = Date.now();
    const result = await transactionPage(supabaseConfig, TABLE, { columns: COLUMNS, filterQuery, startDate, endDate, page, limit, direction, full: mode === 'full', bounded: true });
    rawRows = result.rows;
    total = result.total;
    const rowsMs = Date.now() - rowsStartedAt;
    console.info('[BarangMasuk] rowsMs', rowsMs);
    console.info('[BarangMasuk] countMs', 0, '(included in rows query)');
    console.info('[BarangMasukAPI] query-ok');

    const includeSummary = url.searchParams.get('includeSummary') !== '0';
    const syncStatus = includeSummary ? await fetchSyncStatus(supabaseConfig) : null;
    const summaryStartedAt = Date.now();
    const summary = result.summary || (includeSummary ? await transactionSummary(supabaseConfig, TABLE, filterQuery) : null);
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
      columns: ['tanggal', 'from', 'to', 'sku', 'namaBarang', 'qty', 'status', 'pic', 'keterangan'],
      data: rows,
      rows,
      values: rows.map(row => ['tanggal', 'from', 'to', 'sku', 'namaBarang', 'qty', 'status', 'pic', 'keterangan'].map(key => row[key] ?? '')),
      total,
      ...(summary ? { summary } : {}),
      page,
      limit: mode === 'full' ? rows.length : limit,
      pageSize: mode === 'full' ? rows.length : limit,
      lastSync: syncStatus?.last_success_at ?? null,
      syncStatus,
      durationMs: Date.now() - startedAt,
    };
    const serializationMs = Date.now() - serializationStartedAt;
    console.info('[BarangMasuk] serializationMs', serializationMs);
    console.info('[BarangMasuk] totalMs', Date.now() - startedAt);
    return json(body);
  } catch (error) {
    console.error('[BarangMasukAPI] Supabase query failed', {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    return json({ success: false, reason: ERROR_REASON, message: SAFE_ERROR_MESSAGE }, 500);
  }
}

export function onRequestGet(context) {
  return handleBarangMasukRequest(context);
}
