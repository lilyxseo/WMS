import { buildInventorySearchQuery } from './inventory-search.js';
import { normalizeSku, normalizeLocation } from './sheet-normalization.js';

// Page distinct SKUs across the entire result, including duplicates crossing batches.
export async function searchStockItems(config, state, fetchFn) {
  const filter = buildInventorySearchQuery(state.query, ['sku', 'nama_barang', 'lokasi_bulky']);
  const seen = new Set(), rows = [];
  const skip = (state.page - 1) * 10, batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const response = await fetchFn(`${config.url}/rest/v1/inventory_kartu_stok?select=sku,nama_barang,lokasi_bulky,stok_akhir,source_row_number${state.direction === 'out' ? '&stok_akhir=gt.0' : ''}${filter}&order=sku.asc,lokasi_bulky.asc,source_row_number.asc&limit=${batchSize}&offset=${offset}`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Stock search failed');
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Invalid stock search response');
    for (const row of batch) {
      const sku = normalizeSku(row.sku);
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      if (seen.size > skip) rows.push(row);
      if (rows.length === 11) return { rows: rows.slice(0, 10), hasMore: true };
    }
    if (batch.length < batchSize) return { rows, hasMore: false };
  }
}

export async function stockLocations(config, sku, fetchFn) {
  const groups = new Map(), batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const response = await fetchFn(`${config.url}/rest/v1/inventory_kartu_stok?select=lokasi_bulky,stok_akhir&sku=eq.${encodeURIComponent(sku)}&order=lokasi_bulky.asc,source_row_number.asc&limit=${batchSize}&offset=${offset}`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Stock locations read failed');
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Invalid stock locations response');
    for (const row of batch) {
      const location = normalizeLocation(row.lokasi_bulky);
      if (!location) continue;
      const group = groups.get(location);
      if (group) group.count++;
      else groups.set(location, { count: 1, location, qty: Number(row.stok_akhir) });
    }
    if (batch.length < batchSize) break;
  }
  return [...groups.values()].filter(group => group.count === 1 && Number.isFinite(group.qty) && group.qty > 0);
}
