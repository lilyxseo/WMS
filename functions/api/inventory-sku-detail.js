import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';
import { orderTransactionRows, supabaseRows } from './_transaction-read.js';
import { mapKartuStokRow } from './kartu-stok/index.js';
import { mapRplRow } from './rpl/index.js';
import { mapBulkyRow } from './bulky/index.js';
import { mapBarangMasukRow } from './barang-masuk/index.js';
import { mapBarangKeluarRow } from './barang-keluar/index.js';

const SOURCES = {
  'Kartu Stock': { table: 'inventory_kartu_stok', map: mapKartuStokRow, order: 'source_row_number.asc' },
  RPL: { table: 'inventory_rpl', map: mapRplRow, order: 'source_row_number.asc' },
  BULKY: { table: 'inventory_bulky', map: mapBulkyRow, order: 'source_row_number.asc' },
  'Barang Masuk': { table: 'inventory_barang_masuk', map: mapBarangMasukRow, transaction: true },
  'Barang Keluar': { table: 'inventory_barang_keluar', map: mapBarangKeluarRow, transaction: true },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function fetchSkuSource(config, source, sku) {
  const filter = `sku=eq.${encodeURIComponent(sku)}`;
  const order = source.transaction ? 'source_row_number.desc' : source.order;
  const rawRows = [];
  const batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const { payload } = await supabaseRows(config, `${source.table}?select=*&${filter}&order=${order}&offset=${offset}&limit=${batchSize}`);
    rawRows.push(...payload);
    if (payload.length < batchSize) break;
  }
  const rows = source.transaction ? orderTransactionRows(rawRows, 'desc').map(item => item.row) : rawRows;
  return rows.map(source.map);
}

export async function handleInventorySkuDetailRequest({ request, env }) {
  const role = await getRequestRole(request, env);
  if (!role) return json({ success: false, message: 'Sesi tidak valid untuk membaca detail SKU' }, 401);

  const sku = String(new URL(request.url).searchParams.get('sku') || '').trim();
  if (!sku) return json({ success: false, message: 'SKU wajib diisi' }, 400);

  try {
    const config = getSecretSupabaseConfig(env);
    const entries = await Promise.all(Object.entries(SOURCES).map(async ([name, source]) => [name, await fetchSkuSource(config, source, sku)]));
    const sources = Object.fromEntries(entries);
    const found = entries.some(([, rows]) => rows.length > 0);
    return json({ success: true, found, sku, sources });
  } catch (error) {
    console.error('[InventorySkuDetailAPI]', error?.message || error);
    return json({ success: false, message: 'Gagal memuat detail SKU' }, 502);
  }
}

export function onRequestGet(context) {
  return handleInventorySkuDetailRequest(context);
}
