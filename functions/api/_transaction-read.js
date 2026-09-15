export const TRANSACTION_COLUMNS = 'tanggal,from_location,to_location,sku,nama_barang,qty,status,pic,keterangan,source_row_number';

export function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, match => `\\${match}`);
}

export function exactTotal(response, fallback = 0) {
  const total = String(response.headers.get('content-range') || '').split('/')[1];
  return total && total !== '*' ? Number(total) : fallback;
}

export async function supabaseRows(config, path, { count = false } = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, ...(count ? { Prefer: 'count=exact' } : {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || `Supabase HTTP ${response.status}`);
    Object.assign(error, { name: 'SupabaseError', code: payload?.code, details: payload?.details, hint: payload?.hint });
    throw error;
  }
  if (!Array.isArray(payload)) throw new TypeError('Supabase returned an invalid response body');
  return { payload, response };
}

// Only two scalar columns cross the database/backend boundary for these cards;
// transaction detail rows are never materialized in the browser.
export async function transactionSummary(config, table, filterQuery = '') {
  const rows = [];
  const batchSize = 1000;
  let total = 0;
  for (let offset = 0; ; offset += batchSize) {
    const result = await supabaseRows(config, `${table}?select=sku,qty${filterQuery}&offset=${offset}&limit=${batchSize}`, { count: offset === 0 });
    if (offset === 0) total = exactTotal(result.response, result.payload.length);
    rows.push(...result.payload);
    if (result.payload.length < batchSize || rows.length >= total) break;
  }
  return {
    totalRows: total,
    totalQty: rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0),
    totalSku: new Set(rows.map(row => String(row.sku || '').trim().toUpperCase()).filter(Boolean)).size,
  };
}
