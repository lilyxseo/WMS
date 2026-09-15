import { getSecretSupabaseConfig } from '../_supabase-config.js';
import { escapeLike, exactTotal, supabaseRows, transactionSummary } from '../_transaction-read.js';

const TABLE = 'inventory_barang_masuk';
// Keep reads compatible with the deployed table schema. In particular, synced_at is
// optional metadata and must not make the whole endpoint fail when it is not present.
const COLUMNS = '*';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const FULL_BATCH_SIZE = 1000;
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
    if (startDate) filters.push(`tanggal=gte.${encodeURIComponent(startDate)}`);
    if (endDate) filters.push(`tanggal=lte.${encodeURIComponent(endDate)}`);
    const filterQuery = filters.length ? `&${filters.join('&')}` : '';

    let rawRows = [];
    let total = 0;
    console.info('[BarangMasukAPI] query-start');
    if (mode === 'full') {
      for (let offset = 0; ; offset += FULL_BATCH_SIZE) {
        const result = await supabaseGet(supabaseConfig, `${TABLE}?select=${COLUMNS}${filterQuery}&order=source_row_number.asc&offset=${offset}&limit=${FULL_BATCH_SIZE}`, { count: offset === 0 });
        rawRows.push(...result.payload);
        if (offset === 0) total = exactTotal(result.response, result.payload.length);
        if (result.payload.length < FULL_BATCH_SIZE || (total > 0 && rawRows.length >= total)) break;
      }
    } else {
      const offset = (page - 1) * limit;
      const result = await supabaseGet(supabaseConfig, `${TABLE}?select=${COLUMNS}${filterQuery}&order=source_row_number.asc&offset=${offset}&limit=${limit}`, { count: true });
      rawRows = result.payload;
      total = exactTotal(result.response, result.payload.length);
    }
    console.info('[BarangMasukAPI] query-ok');

    const [syncStatus, summary] = await Promise.all([fetchSyncStatus(supabaseConfig), mode === 'full' ? Promise.resolve(null) : transactionSummary(supabaseConfig, TABLE, filterQuery)]);
    const rows = rawRows.map(mapBarangMasukRow);
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
    console.info('[BarangMasukAPI] response-ready');
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
