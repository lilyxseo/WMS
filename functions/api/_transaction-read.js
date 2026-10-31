import {transactionFilterRows} from './_transaction-filters.js';
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

export async function supabaseRows(config, path, { count = false, method = 'GET', body, signal } = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method, ...(body?{body:JSON.stringify(body)}:{}), signal:signal||AbortSignal.timeout(20000),
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, ...(body?{'Content-Type':'application/json'}:{}), ...(count ? { Prefer: 'count=exact' } : {}) },
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

function naturalText(value) {
  return String(value ?? '').trim();
}

function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('id').replace(/\s+/g, ' ').trim();
}

/** Match every visible business value, including dates, quantities, URLs and booleans. */
export function transactionRowMatchesSearch(row, search = '', fields = []) {
  const tokens = normalizeSearchText(search).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const values = fields.length ? fields.map(field => row?.[field]) : Object.entries(row || {})
    .filter(([field]) => field !== 'source_row_number' && !field.startsWith('sync_'))
    .map(([, value]) => value);
  const haystack = normalizeSearchText(values.join(' '));
  return tokens.every(token => haystack.includes(token));
}

function stableRowOrder(a, b, direction = 'asc') {
  const difference = (Number(a.source_row_number) || 0) - (Number(b.source_row_number) || 0);
  return direction === 'desc' ? -difference : difference;
}

export function orderTransactionRows(rows, sort = 'latest') {
  const selected = transactionSort(typeof sort === 'string' ? sort : sort?.name);
  return rows.map(row => ({ row, parsedDate: normalizeTransactionDate(row.tanggal) }))
    .sort((a, b) => {
      let result = 0;
      if (selected.field === 'tanggal') {
        if (a.parsedDate.valid !== b.parsedDate.valid) return a.parsedDate.valid ? -1 : 1;
        result = a.parsedDate.valid ? a.parsedDate.value.localeCompare(b.parsedDate.value) : 0;
      } else if (selected.field === 'qty') {
        const leftRaw = naturalText(a.row.qty), rightRaw = naturalText(b.row.qty);
        const left = Number(leftRaw), right = Number(rightRaw);
        const leftValid = Boolean(leftRaw) && Number.isFinite(left), rightValid = Boolean(rightRaw) && Number.isFinite(right);
        if (leftValid !== rightValid) return leftValid ? -1 : 1;
        result = leftValid ? left - right : 0;
      } else {
        const left = naturalText(a.row[selected.field]), right = naturalText(b.row[selected.field]);
        if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
        // Numeric collation gives the expected A2 < A10 ordering without ever
        // coercing the SKU (and therefore without discarding leading zeroes).
        result = left.localeCompare(right, 'id', { numeric: true, sensitivity: 'base' });
      }
      if (result) return selected.direction === 'desc' ? -result : result;
      return stableRowOrder(a.row, b.row, selected.direction);
    });
}

// Transaction rows are appended to their source sheets in transaction order.
// Keep the public sort vocabulary separate from PostgREST column names: there
// is deliberately no `normalized_date` database column in the deployed tables.
export function transactionSort(sort) {
  const allowlist = {
    latest: { field: 'tanggal', direction: 'desc' },
    oldest: { field: 'tanggal', direction: 'asc' },
    'sku-asc': { field: 'sku', direction: 'asc' },
    'name-asc': { field: 'nama_barang', direction: 'asc' },
    'qty-desc': { field: 'qty', direction: 'desc' },
    'qty-asc': { field: 'qty', direction: 'asc' },
  };
  const name = Object.hasOwn(allowlist, sort) ? sort : 'latest';
  return { name, ...allowlist[name] };
}

// `tanggal` is text in the deployed inventory tables, so PostgREST cannot
// chronologically order mixed ISO and MM/DD/YYYY values. Read on the server,
// normalize before range filtering, and only then apply page boundaries.
export async function transactionPage(config, table, {
  columns = '*', filterQuery = '', startDate = '', endDate = '', page = 1,
  limit = 50, sort = 'latest', direction, full = false, bounded = false, recentOnly = false,
  search = '', searchFields = [], columnRules={},facet='',sortField='',sortDir=1,
} = {}) {
  if (recentOnly && !filterQuery && !startDate && !endDate && sort === 'latest' && !full && !Object.keys(columnRules).length && !facet && !sortField) {
    const offset = (page - 1) * limit;
    const result = await supabaseRows(config, `${table}?select=${columns}&order=source_row_number.desc&offset=${offset}&limit=${limit}`, { count: true });
    return { rows: result.payload, total: exactTotal(result.response, result.payload.length), summary: null };
  }
  // PostgREST applies the search/status filters first. All matching rows are
  // then read in bounded batches so normalization and sorting happen server-side
  // across the complete result set before this function slices the requested page.
  if(search.length>500)throw new RangeError('Pencarian maksimal 500 karakter.');
  const selectedSort = transactionSort(sort === 'latest' && direction ? (direction === 'asc' ? 'oldest' : 'latest') : sort);
  const searchRpc = search.trim() && ['inventory_barang_masuk','inventory_barang_keluar'].includes(table)
    ? 'rpc/wms_search_'+table.replace('inventory_','') : '';
  let useSearchRpc=Boolean(searchRpc);
  let rows = [],readCount=0;const skuSet=new Set(),facets=new Set();let totalRows=0,totalQty=0,latestDate=null,oldestDate=null,invalidDateCount=0;
  let sourceTotal = null, lastBatchSize=TRANSACTION_READ_BATCH_SIZE;
  for (let offset = 0; ; offset += lastBatchSize) {
    const query=`?select=${columns}${filterQuery}&order=source_row_number.desc&offset=${offset}&limit=${TRANSACTION_READ_BATCH_SIZE}`;
    let result;
    try { result=await supabaseRows(config,(useSearchRpc?searchRpc:table)+query,{count:offset===0,...(useSearchRpc?{method:'POST',body:{p_query:search}}:{})}); }
    catch(error){
      // Old deployments remain readable during rollout. Never turn a timeout or
      // permission failure into another full scan.
      if(!useSearchRpc||!['PGRST202','42883'].includes(error.code))throw error;
      useSearchRpc=false;rows=[];readCount=0;skuSet.clear();facets.clear();totalRows=0;totalQty=0;latestDate=null;oldestDate=null;invalidDateCount=0;sourceTotal=null;offset=0;lastBatchSize=0;continue;
    }
    if (offset === 0) sourceTotal = exactTotal(result.response, result.payload.length);
    readCount+=result.payload.length;lastBatchSize=result.payload.length;
    const ordered=orderTransactionRows(result.payload,selectedSort);invalidDateCount+=ordered.filter(item=>!item.parsedDate.valid).length;
    const scoped=ordered.filter(({row,parsedDate})=>transactionRowMatchesSearch(row,search,searchFields)&&(!startDate&&!endDate||parsedDate.valid&&(!startDate||parsedDate.value>=startDate)&&(!endDate||parsedDate.value<=endDate)));
    const batch=transactionFilterRows(scoped,{columnRules,facet,sortField,sortDir});for(const value of batch.facetValues||[])facets.add(value);
    for(const item of batch.filtered){totalRows++;totalQty+=Number(item.row.qty)||0;const sku=String(item.row.sku||'').trim().toUpperCase();if(sku)skuSet.add(sku);const date=item.parsedDate.value;if(item.parsedDate.valid){if(!latestDate||date>latestDate)latestDate=date;if(!oldestDate||date<oldestDate)oldestDate=date;}}
    if(!facet){rows.push(...batch.filtered.map(item=>item.row));if(!full){let top=orderTransactionRows(rows,selectedSort);if(sortField)top=transactionFilterRows(top,{sortField,sortDir}).filtered;rows=top.slice(0,page*limit).map(item=>item.row);}}
    if(!result.payload.length||readCount>=sourceTotal)break;
  }
  let ordered=orderTransactionRows(rows,selectedSort);if(sortField)ordered=transactionFilterRows(ordered,{sortField,sortDir}).filtered;
  const summary={totalRows,totalQty,totalSku:skuSet.size,latestDate,oldestDate,invalidDateCount},offset=(page-1)*limit;
  return {facetValues:facet?[...facets].sort():undefined,rows:(full?ordered:ordered.slice(offset,offset+limit)).map(item=>item.row),total:totalRows,summary};
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
