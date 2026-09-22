import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';
import { orderTransactionRows, supabaseRows } from './_transaction-read.js';
import { mapKartuStokRow } from './kartu-stok/index.js';
import { mapRplRow } from './rpl/index.js';
import { mapBulkyRow } from './bulky/index.js';
import { mapBarangMasukRow } from './barang-masuk/index.js';
import { mapBarangKeluarRow } from './barang-keluar/index.js';

const INVENTORY_COLUMNS = 'lokasi_bulky,sku,nama_barang,stok_awal,internal_stock_transfer,replenishment,pengeluaran,stok_akhir,source_row_number';
const TRANSACTION_COLUMNS = 'tanggal,from_location,to_location,sku,nama_barang,qty,status,pic,keterangan,source_row_number';
const BARANG_MASUK_TRANSACTION_COLUMNS = 'tanggal,from_location,to_location,sku,nama_barang,qty,status,pic,keterangan,no_iseller,netsuite,keterangan_lainnya,lokasi_surat_jalan,stockout,dokumen,source_row_number';
const SOURCES = {
  'Kartu Stock': { table: 'inventory_kartu_stok', select: INVENTORY_COLUMNS, map: mapKartuStokRow, order: 'source_row_number.asc' },
  RPL: { table: 'inventory_rpl', select: INVENTORY_COLUMNS, map: mapRplRow, order: 'source_row_number.asc' },
  BULKY: { table: 'inventory_bulky', select: INVENTORY_COLUMNS, map: mapBulkyRow, order: 'source_row_number.asc' },
  'Barang Masuk': { table: 'inventory_barang_masuk', select: BARANG_MASUK_TRANSACTION_COLUMNS, map: mapBarangMasukRow, transaction: true },
  'Barang Keluar': { table: 'inventory_barang_keluar', select: TRANSACTION_COLUMNS, map: mapBarangKeluarRow, transaction: true },
};

const INTERNAL_COLUMNS = new Set(['rownumber', 'sourcerownumber', 'syncedat']);

export function toSkuDetailRow(row = {}) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !INTERNAL_COLUMNS.has(String(key).replace(/[^a-z0-9]/gi, '').toLowerCase())));
}

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
    const { payload } = await supabaseRows(config, `${source.table}?select=${source.select}&${filter}&order=${order}&offset=${offset}&limit=${batchSize}`);
    rawRows.push(...payload);
    if (payload.length < batchSize) break;
  }
  const rows = source.transaction ? orderTransactionRows(rawRows, 'oldest').map(item => item.row) : rawRows;
  return rows.map(source.map).map(toSkuDetailRow);
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
