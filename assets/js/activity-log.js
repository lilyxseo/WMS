/** Global, non-blocking activity audit service. Sensitive keys are removed recursively. */
export const SEARCH_ACTIVITY_LOGGING = false;
const SENSITIVE = /password|passcode|token|cookie|secret|api.?key|private.?key|credential/i;
const queue = [];
const seen = new Set();
let timer;

export function createActivityId() {
  return globalThis.crypto?.randomUUID?.() || `act-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clean(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 500).map(v => clean(v, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 1000) : value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE.test(key))
    .map(([key, child]) => [key, clean(child, depth + 1)]));
}

function valueLabel(value) { return value === '' || value == null ? 'kosong' : `“${String(value)}”`; }
function entityLabel(p) { return `${p.entityType || 'data'}${p.entityId ? ` ${p.entityId}` : ''}`; }
function updateDescription(p) {
  const changes = p.changes || p.details?.changes || [];
  if (changes.length === 1) {
    const c = changes[0];
    const prefix = p.source === 'INLINE_EDIT' ? 'Inline edit' : 'Mengubah';
    return `${prefix} ${c.field} ${entityLabel(p)} dari ${valueLabel(c.oldValue)} menjadi ${valueLabel(c.newValue)}${p.source === 'LOCATION_CARD' ? ' melalui card Lokasi' : ''}.`;
  }
  return `Mengubah ${changes.length} field pada ${entityLabel(p)}: ${changes.map(c => c.field).join(', ')}.`;
}

function normalize(input) {
  const action = String(input.action || 'UNKNOWN').toUpperCase();
  const id = input.id || input.activityId || createActivityId();
  const details = clean({ ...(input.metadata || {}), ...(input.details || {}), ...(input.changes ? { changes: input.changes } : {}) });
  return clean({
    id, user_id:input.user_id||null, timestamp: input.timestamp || new Date().toISOString(),
    user: input.user || input.user_name || input.user_id || 'Unknown', role: input.role || 'User',
    isDeveloper: Boolean(input.isDeveloper), sessionId: input.sessionId || null,
    action, category: input.category || ({ LOGIN: 'AUTH', AUTO_LOGIN: 'AUTH', LOGIN_FAILED: 'AUTH', PAGE_VIEW: 'NAVIGATION', LOGOUT: 'AUTH' }[action] || 'OPERATION'),
    module: input.module || 'System', page: input.page || globalThis.location?.pathname || '/',
    description: input.description || input.detail || `${action} pada ${input.module || 'aplikasi'}.`,
    entityType: input.entityType || null, entityId: input.entityId || input.reference || null,
    details, result: String(input.result || input.status || 'SUCCESS').toUpperCase(), source: input.source || 'WEB',
  });
}

async function send(batch) {
  const response = await fetch('/api/activity-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch.length === 1 ? batch[0] : { activities: batch }) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
export async function flushActivityQueue() {
  clearTimeout(timer); timer = null;
  if (!queue.length) return;
  const batch = queue.splice(0, 20);
  try { await send(batch); } catch (error) {
    queue.unshift(...batch); console.warn('Activity log akan dicoba kembali:', error); timer = setTimeout(flushActivityQueue, 5000); return;
  }
  if (queue.length) timer = setTimeout(flushActivityQueue, 250);
}
export function logActivity(payload, { immediate = false } = {}) {
  const activity = normalize(payload);
  if (seen.has(activity.id)) return Promise.resolve(activity.id);
  seen.add(activity.id); queue.push(activity);
  if (immediate) return flushActivityQueue().then(() => activity.id);
  timer ||= setTimeout(flushActivityQueue, 800);
  return Promise.resolve(activity.id);
}

export const logCreate = p => logActivity({ ...p, action: 'CREATE', category: 'CRUD', description: p.description || `Menambahkan ${entityLabel(p)} di ${p.module}.` });
export const logUpdate = p => logActivity({ ...p, action: 'UPDATE', category: 'CRUD', details: { ...p.details, changes: p.changes || p.details?.changes || [] }, description: p.description || updateDescription(p) });
export const logDelete = p => logActivity({ ...p, action: 'DELETE', category: 'CRUD', details: { ...p.details, snapshot: clean(p.snapshot || p.details?.snapshot) }, description: p.description || `Menghapus ${entityLabel(p)} dari ${p.module}.` });
export const logPageView = p => logActivity({ ...p, action: 'PAGE_VIEW', category: 'NAVIGATION', description: p.description || (p.from ? `Berpindah dari ${p.from} ke ${p.to}.` : `Membuka halaman ${p.module}.`) });
export const logLogin = p => logActivity({ ...p, action: p.auto ? 'AUTO_LOGIN' : (p.failed ? 'LOGIN_FAILED' : 'LOGIN'), category: 'AUTH', description: p.description || (p.failed ? `Percobaan login gagal untuk username ${p.username || 'tidak dikenal'}.` : `${p.user || 'User'} masuk ke aplikasi${p.auto ? ' melalui Auto Login' : ''}.`) }, { immediate: true });
export const logLogout = p => logActivity({ ...p, action: p.expired ? 'SESSION_EXPIRED' : 'LOGOUT', category: 'AUTH', description: p.description || (p.expired ? 'Session berakhir dan user keluar otomatis.' : `${p.user || 'User'} logout dari aplikasi.`) }, { immediate: true });
export const logImport = p => logActivity({ ...p, action: 'IMPORT', category: 'DATA_TRANSFER' });
export const logExport = p => logActivity({ ...p, action: 'EXPORT', category: 'DATA_TRANSFER' });
export const logUndo = p => logActivity({ ...p, action: 'UNDO', category: 'HISTORY' });
export const logRedo = p => logActivity({ ...p, action: 'REDO', category: 'HISTORY' });

export async function logActivityResult(basePayload, actionFn) {
  try { const result = await actionFn(); await logActivity({ ...basePayload, result: 'SUCCESS' }); return result; }
  catch (error) { await logActivity({ ...basePayload, result: 'FAILED', description: `${basePayload.description || basePayload.action} gagal: ${error?.message || error}`, details: { ...basePayload.details, error: String(error?.message || error) } }); throw error; }
}

globalThis.addEventListener?.('pagehide', () => { if (queue.length && navigator.sendBeacon) navigator.sendBeacon('/api/activity-log', JSON.stringify({ activities: queue.splice(0) })); });
