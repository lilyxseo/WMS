import { getRequestRole } from './_authz.js';
import { loadInventoryAnalyticsRows, normalizeTransactionDate } from './_inventory-analytics.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
}

function key(value) { return String(value ?? '').normalize('NFKC').trim().toUpperCase(); }
function number(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function dayKey(date) { return new Date(`${date}T00:00:00Z`).getTime(); }

export function agingBucket(days, neverMoved = false) {
  if (neverMoved || days > 90) return 'dead';
  if (days > 60) return 'aging';
  if (days > 30) return 'slow';
  return 'active';
}

export function computeStockAging(rows, now = new Date()) {
  const inventory = new Map();
  for (const row of rows.kartuStok || []) {
    const sku = key(row.sku), qty = number(row.stok_akhir);
    if (!sku || qty <= 0) continue;
    const item = inventory.get(sku) || { sku, namaBarang: String(row.nama_barang || '-').trim(), stock: 0, locations: new Set() };
    item.stock += qty;
    if (row.lokasi_bulky) item.locations.add(String(row.lokasi_bulky).trim());
    inventory.set(sku, item);
  }
  const lastOutbound = new Map();
  for (const row of rows.barangKeluar || []) {
    const sku = key(row.sku), date = normalizeTransactionDate(row.tanggal);
    if (!sku || !date || key(row.keterangan) !== 'PENGELUARAN') continue;
    if (!lastOutbound.has(sku) || date > lastOutbound.get(sku)) lastOutbound.set(sku, date);
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const result = [...inventory.values()].map(item => {
    const lastMovement = lastOutbound.get(item.sku) || '';
    const daysSinceMovement = lastMovement ? Math.max(0, Math.floor((today - dayKey(lastMovement)) / 86400000)) : null;
    const neverMoved = !lastMovement;
    return { ...item, locations: [...item.locations].sort(), lastMovement, daysSinceMovement, neverMoved, bucket: agingBucket(daysSinceMovement ?? Infinity, neverMoved) };
  });
  const order = { dead: 0, aging: 1, slow: 2, active: 3 };
  result.sort((a, b) => order[a.bucket] - order[b.bucket] || (b.daysSinceMovement ?? Infinity) - (a.daysSinceMovement ?? Infinity) || b.stock - a.stock);
  const summary = { totalSku: result.length, totalUnits: 0, active: 0, slow: 0, aging: 0, dead: 0, deadUnits: 0, neverMoved: 0 };
  for (const item of result) {
    summary.totalUnits += item.stock; summary[item.bucket]++;
    if (item.bucket === 'dead') summary.deadUnits += item.stock;
    if (item.neverMoved) summary.neverMoved++;
  }
  return { rows: result, summary };
}

export async function onRequestGet({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try {
    const { rows, failures } = await loadInventoryAnalyticsRows(env, { sourceNames: ['kartuStok', 'barangKeluar'] });
    const result = computeStockAging(rows);
    return json({ success: true, ...result, generatedAt: new Date().toISOString(), partial: failures.length > 0, unavailableSources: failures.map(item => item.source) });
  } catch (error) {
    console.error('[InventoryAging]', error?.message || error);
    return json({ success: false, message: 'Gagal menghitung umur stok.' }, 502);
  }
}
