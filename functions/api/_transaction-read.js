export const TRANSACTION_COLUMNS = 'tanggal,from_location,to_location,sku,nama_barang,qty,status,pic,keterangan,source_row_number';
export const TRANSACTION_READ_BATCH_SIZE = 1000;

// Inventory sheets define slash dates as MM/DD/YYYY. Keep this deliberately
// strict: accepting Date.parse() here would make ambiguous/localized values
// sort differently between runtimes.
export function normalizeTransactionDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: false, value: null };
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  let year, month, day;
  if (match) {
    [, year, month, day] = match;
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (!match) return { valid: false, value: null };
    [, month, day, year] = match;
  }
  const y = Number(year), m = Number(month), d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { valid: false, value: null };
  }
  return { valid: true, value: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

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

export function orderTransactionRows(rows, direction = 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;
  return rows.map(row => ({ row, parsedDate: normalizeTransactionDate(row.tanggal) }))
    .sort((a, b) => {
      if (a.parsedDate.valid !== b.parsedDate.valid) return a.parsedDate.valid ? -1 : 1;
      const byDate = a.parsedDate.valid ? a.parsedDate.value.localeCompare(b.parsedDate.value) * multiplier : 0;
      if (byDate) return byDate;
      return (Number(b.row.source_row_number) || 0) - (Number(a.row.source_row_number) || 0);
    });
}

// Transaction rows are appended to their source sheets in transaction order.
// Keep the public sort vocabulary separate from PostgREST column names: there
// is deliberately no `normalized_date` database column in the deployed tables.
export function transactionSort(sort) {
  return sort === 'oldest'
    ? { name: 'oldest', direction: 'asc', databaseOrder: 'source_row_number.asc' }
    : { name: 'latest', direction: 'desc', databaseOrder: 'source_row_number.desc' };
}

// `tanggal` is text in the deployed inventory tables, so PostgREST cannot
// chronologically order mixed ISO and MM/DD/YYYY values. Read on the server,
// normalize before range filtering, and only then apply page boundaries.
export async function transactionPage(config, table, {
  columns = '*', filterQuery = '', startDate = '', endDate = '', page = 1,
  limit = 50, direction = 'desc', full = false, bounded = false,
} = {}) {
  // The normal list path must stay bounded: PostgREST applies filtering, stable
  // ordering and the requested range, and returns the exact count in the same
  // response. Date-range reads retain the legacy normalization path because the
  // deployed `tanggal` column contains mixed textual formats.
  if (bounded && !full && !startDate && !endDate) {
    const offset = (page - 1) * limit;
    const databaseOrder = direction === 'asc' ? 'source_row_number.asc' : 'source_row_number.desc';
    const result = await supabaseRows(config, `${table}?select=${columns}${filterQuery}&order=${databaseOrder}&offset=${offset}&limit=${limit}`, { count: true });
    return { rows: result.payload, total: exactTotal(result.response, result.payload.length), summary: null };
  }
  const rows = [];
  let sourceTotal = null;
  for (let offset = 0; ; offset += TRANSACTION_READ_BATCH_SIZE) {
    const result = await supabaseRows(config, `${table}?select=${columns}${filterQuery}&order=source_row_number.desc&offset=${offset}&limit=${TRANSACTION_READ_BATCH_SIZE}`, { count: offset === 0 });
    if (offset === 0) sourceTotal = exactTotal(result.response, result.payload.length);
    rows.push(...result.payload);
    if (result.payload.length < TRANSACTION_READ_BATCH_SIZE || rows.length >= sourceTotal) break;
  }
  const ordered = orderTransactionRows(rows, direction);
  const filtered = ordered.filter(({ parsedDate }) => !startDate && !endDate
    || parsedDate.valid && (!startDate || parsedDate.value >= startDate) && (!endDate || parsedDate.value <= endDate));
  const validDates = filtered.filter(item => item.parsedDate.valid).map(item => item.parsedDate.value);
  const summary = {
    totalRows: filtered.length,
    totalQty: filtered.reduce((sum, item) => sum + (Number(item.row.qty) || 0), 0),
    totalSku: new Set(filtered.map(item => String(item.row.sku || '').trim().toUpperCase()).filter(Boolean)).size,
    latestDate: validDates.length ? validDates.reduce((max, date) => date > max ? date : max) : null,
    oldestDate: validDates.length ? validDates.reduce((min, date) => date < min ? date : min) : null,
    invalidDateCount: ordered.filter(item => !item.parsedDate.valid).length,
  };
  const offset = (page - 1) * limit;
  return { rows: (full ? filtered : filtered.slice(offset, offset + limit)).map(item => item.row), total: filtered.length, summary };
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
