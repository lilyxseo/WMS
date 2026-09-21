import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';
import { buildInventorySearchQuery, normalizeSearchQuery } from './_inventory-search.js';

const SOURCES = [
  ['Kartu Stock', 'inventory_kartu_stok'], ['RPL', 'inventory_rpl'], ['BULKY', 'inventory_bulky'],
  ['Barang Masuk', 'inventory_barang_masuk'], ['Barang Keluar', 'inventory_barang_keluar'],
];
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }

export async function onRequestGet({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  const url = new URL(request.url), q = normalizeSearchQuery(url.searchParams.get('q')), selected = String(url.searchParams.get('source') || '');
  if (q.length < 2) return json({ success: false, message: 'Pencarian minimal 2 karakter' }, 400);
  try {
    const config = getSecretSupabaseConfig(env);
    const active = SOURCES.filter(([name]) => !selected || name === selected);
    const batches = await Promise.all(active.map(async ([source, table]) => {
      const fields = ['inventory_rpl', 'inventory_bulky', 'inventory_kartu_stok'].includes(table)
        ? ['sku', 'nama_barang', 'lokasi_bulky']
        : ['sku', 'nama_barang', 'from_location', 'to_location'];
      const searchQuery = buildInventorySearchQuery(q, fields);
      const response = await fetch(`${config.url}/rest/v1/${table}?select=sku,nama_barang${searchQuery}&limit=50`, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || `Supabase HTTP ${response.status}`);
      return (Array.isArray(payload) ? payload : []).map(row => ({ sku: String(row.sku || ''), nama: String(row.nama_barang || '-'), source }));
    }));
    const grouped = new Map();
    for (const row of batches.flat()) { const sku = row.sku.trim().toUpperCase(); if (!sku) continue; const item = grouped.get(sku) || { sku: row.sku, nama: row.nama, sources: [] }; if (!item.sources.includes(row.source)) item.sources.push(row.source); grouped.set(sku, item); }
    return json({ success: true, source: 'supabase', rows: [...grouped.values()].slice(0, 100), total: grouped.size });
  } catch (error) {
    console.error('[InventorySearch]', error?.message || error);
    return json({ success: false, source: 'supabase', message: 'Pencarian inventory gagal.' }, 502);
  }
}
