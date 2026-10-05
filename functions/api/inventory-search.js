import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';
import { buildInventorySearchQuery, normalizeSearchQuery } from './_inventory-search.js';

const SOURCES = [
  ['Kartu Stock', 'inventory_kartu_stok'], ['RPL', 'inventory_rpl'], ['BULKY', 'inventory_bulky'],
  ['Barang Masuk', 'inventory_barang_masuk'], ['Barang Keluar', 'inventory_barang_keluar'],
];
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }

function inventoryNumber(value) {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export function groupInventorySearchRows(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const sku = String(row.sku || '').trim().toUpperCase();
    if (!sku) continue;
    const item = grouped.get(sku) || {
      sku: String(row.sku || '').trim(),
      nama: row.nama || '-',
      sources: [],
      summary: { distribution: { 'Kartu Stock': 0, RPL: 0, BULKY: 0 }, locations: [] },
    };
    if (!item.sources.includes(row.source)) item.sources.push(row.source);
    if (Object.prototype.hasOwnProperty.call(item.summary.distribution, row.source)) {
      item.summary.distribution[row.source] += inventoryNumber(row.qty);
      const location = String(row.location || '').trim();
      if (location && !item.summary.locations.includes(location)) item.summary.locations.push(location);
    }
    grouped.set(sku, item);
  }
  return grouped;
}

export async function onRequestGet({ request, env }) {
  const startedAt = Date.now(), authStartedAt = Date.now();
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  const authMs = Date.now() - authStartedAt;
  const url = new URL(request.url), q = normalizeSearchQuery(url.searchParams.get('q')), selected = String(url.searchParams.get('source') || '');
  if (q.length < 2) return json({ success: false, message: 'Pencarian minimal 2 karakter' }, 400);
  try {
    const dbStartedAt = Date.now();
    const config = getSecretSupabaseConfig(env);
    const active = SOURCES.filter(([name]) => !selected || name === selected);
    const batches = await Promise.all(active.map(async ([source, table]) => {
      const isStockSource = ['inventory_rpl', 'inventory_bulky', 'inventory_kartu_stok'].includes(table);
      const fields = isStockSource
        ? ['sku', 'nama_barang', 'lokasi_bulky']
        : ['sku', 'nama_barang', 'from_location', 'to_location'];
      const searchQuery = buildInventorySearchQuery(q, fields);
      const selectedFields = isStockSource ? 'sku,nama_barang,lokasi_bulky,stok_akhir' : 'sku,nama_barang';
      const response = await fetch(`${config.url}/rest/v1/${table}?select=${selectedFields}${searchQuery}&limit=50`, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || `Supabase HTTP ${response.status}`);
      return (Array.isArray(payload) ? payload : []).map(row => ({
        sku: String(row.sku || ''), nama: String(row.nama_barang || '-'), source,
        qty: isStockSource ? row.stok_akhir : 0,
        location: isStockSource ? row.lokasi_bulky : '',
      }));
    }));
    const grouped = groupInventorySearchRows(batches.flat());
    const rows = [...grouped.values()].slice(0, 100), dbMs = Date.now() - dbStartedAt, serializationStartedAt = Date.now();
    const metrics = { authMs, dbMs, serializationMs: Date.now() - serializationStartedAt, totalMs: Date.now() - startedAt, returnedRows: rows.length };
    console.info('[CariData] requestMetrics', metrics);
    return json({ success: true, source: 'supabase', rows, total: grouped.size, metrics });
  } catch (error) {
    console.error('[InventorySearch]', error?.message || error);
    return json({ success: false, source: 'supabase', message: 'Pencarian inventory gagal.' }, 502);
  }
}
