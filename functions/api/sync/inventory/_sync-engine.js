import { token as getGoogleAccessToken } from '../../_barang-ops.js';
import { getSecretSupabaseConfig } from '../../_supabase-config.js';

export const SYNC_BATCH_SIZE = 1000;
export const SYNC_READ_PAGE_SIZE = 1000;
export const SOURCE_SIZE_GUARD = Object.freeze({ previousMinimum: 100, minimumRatio: 0.25 });
export const GOOGLE_429_DELAYS_MS = Object.freeze([2000, 5000, 10000]);
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const SMART_DASH = /[\u2010-\u2015\u2212]/g;

export class SyncError extends Error {
  constructor(code, message = code, details = {}) { super(message); this.name = 'SyncError'; this.code = code; Object.assign(this, details); }
}

export function normalizeText(value) {
  return (value == null ? '' : String(value)).normalize('NFC').replace(ZERO_WIDTH, '').trim();
}
export function normalizeSku(value) { return normalizeText(value).replace(SMART_DASH, '-'); }
export function normalizeLocation(value) {
  let clean = normalizeText(value);
  try { clean = decodeURIComponent(clean); } catch (_error) { /* retain malformed URI text */ }
  return normalizeText(clean).replace(SMART_DASH, '-').replace(/\s+/g, ' ').toUpperCase();
}
export function normalizeNumber(value) {
  if (value == null || normalizeText(value) === '') return { valid: true, value: null };
  if (typeof value === 'number') return Number.isFinite(value) ? { valid: true, value } : { valid: false };
  const raw = normalizeText(value);
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw)) return { valid: false };
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? { valid: true, value: parsed } : { valid: false };
}
export function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return { valid: true, value: null };

  let year, month, day;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    [, year, month, day] = match;
  } else {
    // Movement endpoints write dates to these sheets as M/D/YYYY.
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (!match) return { valid: false };
    [, month, day, year] = match;
  }

  const yearNumber = Number(year), monthNumber = Number(month), dayNumber = Number(day);
  const parsed = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (parsed.getUTCFullYear() !== yearNumber || parsed.getUTCMonth() !== monthNumber - 1 || parsed.getUTCDate() !== dayNumber) {
    return { valid: false };
  }
  return { valid: true, value: `${String(yearNumber).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}` };
}
export function normalizedHeader(value) { return normalizeText(value).toUpperCase().replace(/\s+/g, ' '); }
function bytesToHex(buffer) { return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function sha256(value) { return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }

export function diffRows(sourceRows, sourceKeys, existingRows, needsUpdate = () => false) {
  const existingByKey = new Map(existingRows.map(row => [row.source_row_key, row]));
  const rowsToInsert = [], rowsToUpdate = [];
  let unchanged = 0;
  for (const row of sourceRows) {
    const existing = existingByKey.get(row.source_row_key);
    if (!existing) rowsToInsert.push(row);
    else if (existing.source_hash !== row.source_hash || needsUpdate(existing, row)) rowsToUpdate.push(row);
    else unchanged += 1;
  }
  const keysToDelete = existingRows.map(row => row.source_row_key).filter(key => !sourceKeys.has(key));
  return { rowsToInsert, rowsToUpdate, keysToDelete, unchanged };
}

function chunks(items, size = SYNC_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export function createInventorySyncService(config) {
  const { source, sheetName, tableName, parseValues } = config;
  const buildSourceRowKey = rowNumber => `${source}:${rowNumber}`;
  const buildSourceHash = row => sha256(JSON.stringify(config.hashFields.map(field => row[field])));

  async function fetchValues(env, dependencies = {}) {
    const id = normalizeText(env.SHEET_ID_2026 || env.GOOGLE_SHEET_ID);
    if (!id) throw new SyncError('MISSING_SHEET_CONFIG', 'SHEET_ID_2026/GOOGLE_SHEET_ID belum diset');
    // Service-account token exchange is an outbound request too. Keep it in the
    // Google total so the metric reflects the Worker's actual subrequest budget.
    if (dependencies.requestMetrics) dependencies.requestMetrics.googleRequests += 1;
    const accessToken = await (dependencies.getGoogleAccessToken || getGoogleAccessToken)(env);
    const fetchFn = dependencies.fetch || fetch;
    const wait = dependencies.sleep || sleep;
    const range = `'${sheetName}'!A:ZZ`;
    for (let attempt = 0; ; attempt += 1) {
      if (dependencies.requestMetrics) dependencies.requestMetrics.googleRequests += 1;
      const response = await fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 429 && attempt < GOOGLE_429_DELAYS_MS.length) { await wait(GOOGLE_429_DELAYS_MS[attempt]); continue; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new SyncError(response.status === 429 ? 'GOOGLE_RATE_LIMITED' : 'GOOGLE_FETCH_FAILED', body?.error?.message || `Gagal membaca ${sheetName}`);
      return Array.isArray(body.values) ? body.values : [];
    }
  }

  function createGateway(env, fetchFn = fetch, requestMetrics) {
    let url;
    let key;
    try {
      ({ url, key } = getSecretSupabaseConfig(env));
    } catch (error) {
      const code = String(error.message).includes('must start with') ? 'INVALID_SUPABASE_CONFIG' : 'MISSING_SUPABASE_CONFIG';
      throw new SyncError(code, error.message);
    }
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    async function request(path, options = {}, requestType = 'write') {
      if (requestType === 'rpc') requestMetrics.rpcRequests += 1;
      else if (requestType === 'read') requestMetrics.supabaseReads += 1;
      else requestMetrics.supabaseWrites += 1;
      const response = await fetchFn(`${url}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
      const body = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase request gagal (${response.status})`);
      return body;
    }
    const rpc = (name, args) => request(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }, 'rpc');
    return {
      async acquireLock(lockSource, lockId) { const result = await rpc('acquire_inventory_sync_lock', { p_source: lockSource, p_lock_id: lockId, p_stale_after_seconds: 120 }); return result === true || result?.acquire_inventory_sync_lock === true; },
      finishSuccess(args) { return rpc('finish_inventory_sync_success', { p_source: args.source, p_lock_id: args.lock_id, p_row_count: args.row_count, p_inserted_count: args.inserted_count, p_updated_count: args.updated_count, p_deleted_count: args.deleted_count, p_duration_ms: args.duration_ms, p_source_version: args.source_version }); },
      finishError(lockSource, lockId, message, durationMs) { return rpc('finish_inventory_sync_error', { p_source: lockSource, p_lock_id: lockId, p_error: message, p_duration_ms: durationMs }); },
      async insertHistory(row) { const result = await request('/rest/v1/inventory_sync_history?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }); return result?.[0]?.id; },
      updateHistory(id, row) { return request(`/rest/v1/inventory_sync_history?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) }); },
      async existingMetadata() { const all = [], columns = ['source_row_key', 'source_hash', ...(config.metadataFields || [])].join(','); for (let offset = 0; ; offset += SYNC_READ_PAGE_SIZE) { const page = await request(`/rest/v1/${tableName}?select=${columns}&order=source_row_key&limit=${SYNC_READ_PAGE_SIZE}&offset=${offset}`, {}, 'read'); all.push(...page); if (page.length < SYNC_READ_PAGE_SIZE) return all; } },
      async upsertRows(rows) { for (const batch of chunks(rows)) await request(`/rest/v1/${tableName}?on_conflict=source_row_key`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(batch) }); },
      async deleteKeys(keys) { for (const batch of chunks(keys)) { const values = batch.map(item => `"${String(item).replace(/"/g, '\\"')}"`).join(','); await request(`/rest/v1/${tableName}?source_row_key=in.(${encodeURIComponent(values)})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); } },
    };
  }

  async function sync(env, dependencies = {}) {
    const started = Date.now(), startedAt = new Date(started).toISOString(), lockId = crypto.randomUUID();
    const requestMetrics = { googleRequests: 0, supabaseReads: 0, supabaseWrites: 0, rpcRequests: 0 };
    const gateway = dependencies.gateway || createGateway(env, dependencies.fetch, requestMetrics), logger = dependencies.logger || console;
    let lockAcquired = false, historyId;
    let metrics = { sourceRows: 0, inserted: 0, updated: 0, deleted: 0, unchanged: 0, invalidRows: 0 };
    const errorText = error => `${error?.code ? `${error.code}: ` : ''}${error?.message || String(error)}`.slice(0, 2000);
    const log = message => (logger?.log || console.log)(`[InventorySync:${source}] ${message}`);
    const requestSummary = () => ({ ...requestMetrics, estimatedRequests: Object.values(requestMetrics).reduce((total, count) => total + count, 0) });
    const logRequestSummary = () => { const summary = requestSummary(); log(`googleRequests: ${summary.googleRequests}\nsupabaseReads: ${summary.supabaseReads}\nsupabaseWrites: ${summary.supabaseWrites}\nrpcRequests: ${summary.rpcRequests}\nestimatedRequests: ${summary.estimatedRequests}`); return summary; };
    try {
      lockAcquired = await gateway.acquireLock(source, lockId);
      if (!lockAcquired) { await gateway.insertHistory({ source, status: 'skipped', started_at: startedAt, finished_at: new Date().toISOString(), source_row_count: 0, inserted_count: 0, updated_count: 0, deleted_count: 0, duration_ms: Date.now() - started, error_message: 'SYNC_ALREADY_RUNNING', source_version: null }); return { success: false, skipped: true, reason: 'SYNC_ALREADY_RUNNING', source, durationMs: Date.now() - started }; }
      historyId = await gateway.insertHistory({ source, status: 'syncing', started_at: startedAt, source_row_count: 0, inserted_count: 0, updated_count: 0, deleted_count: 0, duration_ms: 0, error_message: null, source_version: null });
      log('START');
      const parsed = await parseValues(await (dependencies.fetchValues || fetchValues)(env, { ...dependencies, requestMetrics }), { buildSourceRowKey, buildSourceHash, logger });
      metrics.sourceRows = parsed.sourceRowCount; metrics.invalidRows = parsed.invalidRows.length;
      const existing = await gateway.existingMetadata();
      log(`sheet rows: ${metrics.sourceRows}\nexisting rows: ${existing.length}`);
      if (existing.length > 0 && parsed.sourceRowCount === 0) throw new SyncError('SUSPICIOUS_SOURCE_SIZE', 'Source kosong sementara database masih berisi data');
      if (existing.length > SOURCE_SIZE_GUARD.previousMinimum && parsed.sourceRowCount < existing.length * SOURCE_SIZE_GUARD.minimumRatio) throw new SyncError('SOURCE_ROW_COUNT_DROPPED_UNEXPECTEDLY', `Source ${parsed.sourceRowCount}, sebelumnya ${existing.length}`);
      const diff = diffRows(parsed.rows, parsed.sourceKeys, existing, config.needsUpdate);
      metrics = { ...metrics, inserted: diff.rowsToInsert.length, updated: diff.rowsToUpdate.length, deleted: diff.keysToDelete.length, unchanged: diff.unchanged };
      if (config.buildMetrics) metrics = { ...metrics, ...config.buildMetrics({ parsed, existing, diff }) };
      const sourceVersion = await sha256(JSON.stringify(parsed.rows.map(row => [row.source_row_key, row.source_hash])));
      await gateway.upsertRows([...diff.rowsToInsert, ...diff.rowsToUpdate].map(row => ({ ...row, synced_at: new Date().toISOString() })));
      await gateway.deleteKeys(diff.keysToDelete);
      const durationMs = Date.now() - started;
      await gateway.finishSuccess({ source, lock_id: lockId, row_count: metrics.sourceRows, inserted_count: metrics.inserted, updated_count: metrics.updated, deleted_count: metrics.deleted, duration_ms: durationMs, source_version: sourceVersion }); lockAcquired = false;
      await gateway.updateHistory(historyId, { status: 'success', finished_at: new Date().toISOString(), source_row_count: metrics.sourceRows, inserted_count: metrics.inserted, updated_count: metrics.updated, deleted_count: metrics.deleted, duration_ms: durationMs, error_message: null, source_version: sourceVersion });
      log(`insert: ${metrics.inserted}\nupdate: ${metrics.updated}\ndelete: ${metrics.deleted}\nunchanged: ${metrics.unchanged}\nduration: ${durationMs}ms`);
      const requests = logRequestSummary();
      return { success: true, source, ...metrics, invalidRowDiagnostics: parsed.invalidRows, durationMs, sourceVersion, requests };
    } catch (error) {
      const durationMs = Date.now() - started;
      if (lockAcquired) { try { await gateway.finishError(source, lockId, errorText(error), durationMs); } catch (releaseError) { logger.error?.(`[InventorySync:${source}] lock release failed: ${releaseError.message}`); } }
      if (historyId) { try { await gateway.updateHistory(historyId, { status: 'error', finished_at: new Date().toISOString(), source_row_count: metrics.sourceRows, inserted_count: metrics.inserted, updated_count: metrics.updated, deleted_count: metrics.deleted, duration_ms: durationMs, error_message: errorText(error), source_version: null }); } catch (historyError) { logger.error?.(`[InventorySync:${source}] history update failed: ${historyError.message}`); } }
      logRequestSummary();
      throw error;
    }
  }
  return { buildSourceRowKey, buildSourceHash, fetchValues, sync };
}
