import { getSecretSupabaseConfig } from './_supabase-config.js';

const BATCH_SIZE = 1000;
const SOURCES = {
  kartuStok: { table: 'inventory_kartu_stok', select: 'sku,nama_barang,lokasi_bulky,stok_akhir,pengeluaran' },
  rpl: { table: 'inventory_rpl', select: 'sku,nama_barang,lokasi_bulky,stok_akhir' },
  bulky: { table: 'inventory_bulky', select: 'sku,nama_barang,lokasi_bulky,stok_akhir,netsuite,selisih' },
  barangMasuk: { table: 'inventory_barang_masuk', select: 'sku,nama_barang,qty,status,tanggal,to_location' },
  barangKeluar: { table: 'inventory_barang_keluar', select: 'sku,nama_barang,qty,status,tanggal,from_location,keterangan' },
};

async function exactCount(config, table, filter = '') {
  const response = await fetch(`${config.url}/rest/v1/${table}?select=sku${filter}&limit=1`, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Prefer: 'count=exact' } });
  if (!response.ok) throw new Error(`Count ${table} failed (${response.status})`);
  const total = String(response.headers.get('content-range') || '').split('/')[1];
  return total && total !== '*' ? Number(total) : (await response.json()).length;
}

export function businessDateKey(now = new Date(), timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function transactionDateRepresentations(date) {
  const normalized = normalizeTransactionDate(date);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return [];
  const [, year, month, day] = match;
  return [...new Set([normalized, `${Number(month)}/${Number(day)}/${year}`, `${month}/${day}/${year}`])];
}

async function exactBusinessDateCount(config, table, date, filter = '') {
  const dates = transactionDateRepresentations(date);
  const dateFilter = `&or=(${dates.map(value => `tanggal.eq.${encodeURIComponent(value)}`).join(',')})`;
  return exactCount(config, table, `${filter}${dateFilter}`);
}

export async function loadTotalMovement(env) {
  const config = getSecretSupabaseConfig(env);
  // An ilike without wildcards is exact but safely accepts legacy casing.
  return exactCount(config, SOURCES.barangMasuk.table, '&status=ilike.Movement');
}

export async function loadInventoryCounts(env, now = new Date()) {
  const config = getSecretSupabaseConfig(env);
  const businessDate = businessDateKey(now, env.BUSINESS_TIME_ZONE || 'Asia/Jakarta');
  const entries = await Promise.all([
    exactCount(config, SOURCES.kartuStok.table), exactCount(config, SOURCES.rpl.table), exactCount(config, SOURCES.bulky.table),
    exactCount(config, SOURCES.barangMasuk.table, '&sku=not.is.null&status=ilike.BARANG%20MASUK'),
    exactCount(config, SOURCES.barangKeluar.table, '&tanggal=not.is.null&keterangan=ilike.PENGELUARAN'),
    exactCount(config, SOURCES.barangMasuk.table, '&status=ilike.Movement'),
    exactBusinessDateCount(config, SOURCES.barangMasuk.table, businessDate, '&status=ilike.Barang%20Masuk'),
    exactBusinessDateCount(config, SOURCES.barangKeluar.table, businessDate, '&keterangan=ilike.Pengeluaran'),
    exactBusinessDateCount(config, SOURCES.barangMasuk.table, businessDate, '&status=ilike.Movement'),
  ]);
  return {
    kartuStok: entries[0], rpl: entries[1], bulky: entries[2], barangMasuk: entries[3], barangKeluar: entries[4], totalMovement: entries[5],
    barangMasukHariIni: entries[6], barangKeluarHariIni: entries[7], totalMovementHariIni: entries[8], businessDate, today: businessDate,
  };
}

function number(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(value) {
  return String(value ?? '').normalize('NFKC').trim().toUpperCase();
}

export function normalizeTransactionDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (local) {
    let year = Number(local[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(local[1]).padStart(2, '0')}-${String(local[2]).padStart(2, '0')}`;
  }
  return '';
}

async function readAll(config, source) {
  const rows = [];
  let select = source.select;
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const url = `${config.url}/rest/v1/${source.table}?select=${select}&offset=${offset}&limit=${BATCH_SIZE}`;
    const response = await fetch(url, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } });
    const payload = await response.json().catch(() => null);
    // Inventory deployments do not all have exactly the same optional columns.
    // PostgREST rejects the whole request when one selected optional column is
    // absent, so retry that source with its deployed shape instead of making the
    // dashboard unavailable. This remains a server-to-Supabase transfer only.
    if (!response.ok && select !== '*' && (response.status === 400 || payload?.code === '42703' || payload?.code === 'PGRST204')) {
      select = '*';
      offset = -BATCH_SIZE;
      rows.length = 0;
      continue;
    }
    if (!response.ok) {
      const error = new Error(payload?.message || `Supabase HTTP ${response.status}`);
      error.source = source.table;
      error.status = response.status;
      error.code = payload?.code || '';
      throw error;
    }
    if (!Array.isArray(payload)) throw new TypeError(`${source.table} returned an invalid response`);
    rows.push(...payload);
    if (payload.length < BATCH_SIZE) return rows;
  }
}

export async function loadInventoryAnalyticsRows(env) {
  const config = getSecretSupabaseConfig(env);
  const results = await Promise.allSettled(Object.values(SOURCES).map(source => readAll(config, source)));
  const failures = [];
  const rows = Object.fromEntries(Object.keys(SOURCES).map((name, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') return [name, result.value];
    failures.push({ source: result.reason?.source || SOURCES[name].table, status: result.reason?.status || 0, code: result.reason?.code || '' });
    console.error('[InventoryAnalytics] source unavailable', failures.at(-1));
    return [name, []];
  }));
  // A partial summary is safer than a blank dashboard, but returning all zeroes
  // when Supabase itself is unavailable would be misleading.
  if (failures.length === Object.keys(SOURCES).length) {
    const error = new Error('All inventory analytics sources are unavailable');
    error.failures = failures;
    throw error;
  }
  return { rows, failures };
}

export function computeInventorySummary(rows, now = new Date()) {
  const all = Object.values(rows).flat();
  const skuSet = new Set(all.map(row => key(row.sku)).filter(Boolean));
  const today = businessDateKey(now);
  const validInbound = rows.barangMasuk.filter(row => key(row.sku));
  const inbound = validInbound.filter(row => key(row.status) === 'BARANG MASUK');
  const movement = validInbound.filter(row => key(row.status).includes('MOVEMENT'));
  const outbound = rows.barangKeluar.filter(row => normalizeTransactionDate(row.tanggal) && key(row.keterangan) === 'PENGELUARAN');
  const bySku = new Map();
  for (const row of [...rows.rpl, ...rows.bulky]) {
    const sku = key(row.sku);
    if (!sku) continue;
    const item = bySku.get(sku) || { difference: 0, names: new Set(), locations: new Set() };
    // This intentionally mirrors the previous browser accuracy calculation:
    // absent reconciliation/selisih values are treated as zero.
    item.difference += number(row.selisih);
    if (row.nama_barang) item.names.add(key(row.nama_barang));
    if (row.lokasi_bulky) item.locations.add(key(row.lokasi_bulky));
    bySku.set(sku, item);
  }
  const accurate = [...bySku.values()].filter(item => item.difference === 0).length;
  const minusRows = rows.kartuStok.filter(row => number(row.stok_akhir) < 0);
  const minusSkus = new Set(minusRows.map(row => key(row.sku)).filter(Boolean));
  const duplicateSku = [...bySku.values()].filter(item => item.names.size > 1).length;
  const locationMismatch = [...bySku.values()].filter(item => item.locations.size > 1).length;
  const missingSku = all.filter(row => !key(row.sku)).length;
  const warningCount = minusSkus.size + duplicateSku + missingSku + locationMismatch;
  const totalMovement = movement.length;
  return {
    barangMasuk: inbound.length,
    barangMasukHariIni: inbound.filter(row => normalizeTransactionDate(row.tanggal) === today).length,
    barangKeluar: outbound.length,
    barangKeluarHariIni: outbound.filter(row => normalizeTransactionDate(row.tanggal) === today).length,
    kartuStok: rows.kartuStok.length,
    rpl: rows.rpl.length,
    bulky: rows.bulky.length,
    totalSku: skuSet.size,
    totalMovement,
    totalMovementHariIni: movement.filter(row => normalizeTransactionDate(row.tanggal) === today).length,
    minusStock: minusSkus.size,
    minusQuantity: Math.abs(minusRows.reduce((sum, row) => sum + number(row.stok_akhir), 0)),
    warningCount,
    accuracy: bySku.size ? Number(((accurate / bySku.size) * 100).toFixed(2)) : 0,
    accurateSku: accurate,
    inaccurateSku: bySku.size - accurate,
    duplicateSku,
    missingSku,
    locationMismatch,
    reconciliationDifference: [...bySku.values()].reduce((sum, item) => sum + item.difference, 0),
    overstock: rows.kartuStok.filter(row => number(row.stok_akhir) > 0 && number(row.pengeluaran) === 0).length,
    deadStock: rows.kartuStok.filter(row => number(row.stok_akhir) > 0 && number(row.pengeluaran) === 0).length,
  };
}
