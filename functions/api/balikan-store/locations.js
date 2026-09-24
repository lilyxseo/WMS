import { getRequestRole } from '../_authz.js';
import { getSecretSupabaseConfig } from '../_supabase-config.js';

export const BALIKAN_LOCATION_SOURCE = Object.freeze({
  table: 'public.inventory_kartu_stok',
  locationField: 'lokasi_bulky',
  quantityField: 'stok_akhir',
});

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const text = value => String(value ?? '').trim();

export function parseInventoryQuantity(value) {
  if (value === null || value === undefined || text(value) === '') return null;
  const parsed = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function aggregateLocationRows(rows = []) {
  const locations = new Map();
  for (const row of rows) {
    const lokasi = text(row?.lokasi_bulky);
    if (!lokasi) continue;
    const key = lokasi.toLocaleUpperCase('id-ID');
    const qty = parseInventoryQuantity(row?.stok_akhir);
    const current = locations.get(key) || { lokasi, qty: null, rowCount: 0 };
    current.rowCount += 1;
    if (qty !== null) current.qty = (current.qty ?? 0) + qty;
    locations.set(key, current);
  }
  return [...locations.values()].sort((a, b) => (b.qty ?? -Infinity) - (a.qty ?? -Infinity) || a.lokasi.localeCompare(b.lokasi, 'id'));
}

function escapeLike(value) {
  return text(value).replace(/[\\%_]/g, match => `\\${match}`);
}

export async function onRequestGet({ request, env }) {
  const role = await getRequestRole(request, env);
  if (!role) return json({ success: false, message: 'Sesi tidak valid untuk membaca lokasi Balikan Store' }, 401);
  const sku = text(new URL(request.url).searchParams.get('sku'));
  if (!sku) return json({ success: false, message: 'sku wajib diisi' }, 400);

  try {
    const { url, key } = getSecretSupabaseConfig(env);
    const query = new URLSearchParams({
      select: 'lokasi_bulky,sku,stok_akhir,source_row_number',
      sku: `ilike.${escapeLike(sku)}`,
      order: 'source_row_number.asc',
    });
    const response = await fetch(`${url}/rest/v1/inventory_kartu_stok?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const rows = await response.json().catch(() => null);
    if (!response.ok) throw new Error(rows?.message || `Supabase HTTP ${response.status}`);
    const exactRows = (Array.isArray(rows) ? rows : []).filter(row => text(row.sku).toLocaleUpperCase('id-ID') === sku.toLocaleUpperCase('id-ID'));
    return json({
      success: true,
      sku,
      source: BALIKAN_LOCATION_SOURCE,
      locations: aggregateLocationRows(exactRows),
    });
  } catch (error) {
    console.error('[BalikanStoreLocations]', error?.message || error);
    return json({ success: false, message: `Gagal membaca qty lokasi Balikan Store: ${error?.message || 'Unknown error'}` }, 502);
  }
}
