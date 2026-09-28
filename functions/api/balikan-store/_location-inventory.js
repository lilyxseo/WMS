import { getSecretSupabaseConfig } from '../_supabase-config.js';

export const LOCATION_INVENTORY_TABLE = 'inventory_kartu_stok';
export const LOCATION_INVENTORY_QTY_FIELD = 'stok_akhir';
const LOCATION_COLUMNS = 'sku,lokasi_bulky,stok_akhir,source_row_number';
const BATCH_SIZE = 100;

const normalize = value => String(value ?? '').trim().toLowerCase();

export function parseInventoryQty(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function aggregateLocationInventory(rows = []) {
  const bySku = new Map();
  for (const row of rows) {
    const sku = String(row?.sku ?? '').trim();
    const lokasi = String(row?.lokasi_bulky ?? '').trim();
    if (!sku || !lokasi) continue;
    const skuKey = normalize(sku);
    const locationKey = normalize(lokasi);
    if (!bySku.has(skuKey)) bySku.set(skuKey, new Map());
    const locations = bySku.get(skuKey);
    if (!locations.has(locationKey)) {
      locations.set(locationKey, { lokasi, qty: null, rowCount: 0, sourceRows: [] });
    }
    const aggregate = locations.get(locationKey);
    const qty = parseInventoryQty(row?.[LOCATION_INVENTORY_QTY_FIELD]);
    aggregate.rowCount += 1;
    aggregate.sourceRows.push({
      sourceRowNumber: row?.source_row_number ?? null,
      qty,
    });
    if (qty !== null) aggregate.qty = (aggregate.qty ?? 0) + qty;
  }
  return Object.fromEntries([...bySku.entries()].map(([sku, locations]) => [
    sku,
    [...locations.values()].sort((a, b) => (b.qty ?? -Infinity) - (a.qty ?? -Infinity) || a.lokasi.localeCompare(b.lokasi, 'id')),
  ]));
}

function inFilter(values) {
  return `in.(${values.map(value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
}

export async function fetchLocationInventory(env, skus = []) {
  const uniqueSkus = [...new Set(skus.map(value => String(value ?? '').trim()).filter(Boolean))];
  if (!uniqueSkus.length) return {};
  const config = getSecretSupabaseConfig(env);
  const rows = [];
  for (let offset = 0; offset < uniqueSkus.length; offset += BATCH_SIZE) {
    const params = new URLSearchParams({
      select: LOCATION_COLUMNS,
      sku: inFilter(uniqueSkus.slice(offset, offset + BATCH_SIZE)),
      order: 'source_row_number.asc',
    });
    const response = await fetch(`${config.url}/rest/v1/${LOCATION_INVENTORY_TABLE}?${params}`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || `Supabase HTTP ${response.status}`);
    if (!Array.isArray(payload)) throw new TypeError('Respons inventory lokasi tidak valid');
    rows.push(...payload);
  }
  return aggregateLocationInventory(rows);
}
