import { requirePicRole } from './_authz.js';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const REJECT_SPREADSHEET_ID = '1BVGcIWnYqrG-DefzmnO_hZjNn3H3c4sriI7CBAWsxw8';
const STOCK_SHEET = 'KARTU STOCK KST';
const IN_SHEET = 'Barang Masuk';
const OUT_SHEET = 'Barang Keluar';
const SERVER_CACHE_TTL_MS = 5 * 60 * 1000;
let serverBarangRejectCache = null;
let serverBarangRejectLoading = null;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const toB64 = input => btoa(typeof input === 'string' ? input : JSON.stringify(input)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const pemToBuf = pem => {
  const clean = String(pem || '').replace(/\\n/g, '\n').replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
async function token(env) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${toB64({ alg: 'RS256', typ: 'JWT' })}.${toB64({ iss: env.GOOGLE_CLIENT_EMAIL, scope: SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now })}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToBuf(env.GOOGLE_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  let bin = '';
  new Uint8Array(sig).forEach(b => { bin += String.fromCharCode(b); });
  const jwt = `${unsigned}.${btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Gagal membuat access token');
  return data.access_token;
}
function ssId(env) { return String(env.BARANG_REJECT_SHEET_ID || env.SHEET_ID_BARANG_REJECT || REJECT_SPREADSHEET_ID).trim(); }
function isQuotaError(err) {
  const msg = String(err?.message || err || '');
  return /quota|read requests per minute|rate limit/i.test(msg);
}
function cachePayload(spreadsheetId, data) {
  serverBarangRejectCache = { success: true, spreadsheetId, sheets: { stock: STOCK_SHEET, masuk: IN_SHEET, keluar: OUT_SHEET }, ...data, lastSync: Date.now(), fromCache: false };
  return serverBarangRejectCache;
}
function isServerCacheFresh() {
  return !!serverBarangRejectCache && (Date.now() - Number(serverBarangRejectCache.lastSync || 0)) < SERVER_CACHE_TTL_MS;
}
async function valuesGet(access, spreadsheetId, range) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${access}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gagal membaca ${range}`);
  return Array.isArray(data.values) ? data.values : [];
}
async function valuesAppend(access, spreadsheetId, range, row) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [row] }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gagal append ${range}`);
  return data;
}
async function valuesUpdate(access, spreadsheetId, range, values) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gagal update ${range}`);
  return data;
}
const norm = v => String(v ?? '').trim();
const key = (sku, lokasi) => `${norm(sku).toUpperCase()}|${norm(lokasi).toUpperCase()}`;
function isHeader(row, needles) {
  const joined = (row || []).map(v => norm(v).toLowerCase()).join('|');
  return needles.every(n => joined.includes(n));
}
function mapStock(values) {
  const start = values.length && isHeader(values[0], ['sku']) ? 1 : 0;
  return values.slice(start).map((r, i) => ({ rowNumber: start + i + 1, lokasi: r[0] || '', sku: r[1] || '', namaBarang: r[2] || '', qty: Number(r[3] || 0) || 0, status: (Number(r[3] || 0) || 0) > 0 ? 'Ada Stok' : 'Kosong', lastUpdate: '' })).filter(r => norm(r.sku) || norm(r.lokasi) || norm(r.namaBarang));
}
function mapRejectMovement(values, type) {
  const start = values.length && isHeader(values[0], ['tanggal', 'sku']) ? 1 : 0;
  return values.slice(start).map((r, i) => ({
    rowNumber: start + i + 1,
    type,
    tanggal: r[0] || '',
    from: r[1] || '',
    to: r[2] || '',
    sku: r[3] || '',
    namaBarang: r[4] || '',
    qty: Number(r[5] || 0) || 0,
    statusBarang: r[6] || '',
    status: r[6] || '',
    pic: r[7] || '',
    keterangan: r[8] || '',
    noIseller: r[9] || '',
    netsuite: r[10] || '',
    keteranganLainnya: r[11] || '',
    statusProses: type === 'keluar' ? (r[12] || '') : '',
    lokasiSuratJalan: type === 'masuk' ? (r[12] || '') : (r[13] || ''),
    stckoutReject: type === 'masuk' ? (r[13] || '') : ''
  })).filter(r => norm(r.sku) || norm(r.namaBarang));
}
const mapIn = values => mapRejectMovement(values, 'masuk');
const mapOut = values => mapRejectMovement(values, 'keluar');
async function readAll(access, spreadsheetId) {
  const [stockValues, inValues, outValues] = await Promise.all([
    valuesGet(access, spreadsheetId, `${STOCK_SHEET}!A1:D20000`),
    valuesGet(access, spreadsheetId, `${IN_SHEET}!A1:N20000`),
    valuesGet(access, spreadsheetId, `${OUT_SHEET}!A1:N20000`),
  ]);
  return { stock: mapStock(stockValues), masuk: mapIn(inValues), keluar: mapOut(outValues) };
}
function validateCommon(body) {
  const sku = norm(body.sku);
  const namaBarang = norm(body.namaBarang || body.nama_barang);
  const qty = Number(body.qty);
  if (!sku) throw new Error('SKU wajib diisi');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Qty wajib lebih dari 0');
  return { sku, namaBarang, qty };
}
function duplicateRecent(rows, probe) {
  return rows.slice(-50).some(r => Object.entries(probe).every(([k, v]) => norm(r[k]) === norm(v)));
}
export async function onRequestGet({ request, env }) {
  const force = new URL(request.url).searchParams.get('force') === '1';
  if (!force && isServerCacheFresh()) return json({ ...serverBarangRejectCache, fromCache: true });
  try {
    if (!serverBarangRejectLoading) {
      serverBarangRejectLoading = (async () => {
        const access = await token(env);
        const spreadsheetId = ssId(env);
        const data = await readAll(access, spreadsheetId);
        return cachePayload(spreadsheetId, data);
      })().finally(() => { serverBarangRejectLoading = null; });
    }
    return json(await serverBarangRejectLoading);
  } catch (err) {
    if (serverBarangRejectCache && isQuotaError(err)) {
      return json({ ...serverBarangRejectCache, success: true, fromCache: true, warning: 'Google Sheets quota limit. Coba lagi beberapa menit.' });
    }
    return json({ success: false, message: isQuotaError(err) ? 'Google Sheets quota limit. Coba lagi beberapa menit.' : (err?.message || 'Internal server error') }, 500);
  }
}
export async function onRequestPost({ request, env }) {
  const authz = await requirePicRole({ request, env, action: 'CREATE' });
  if (!authz.ok) return authz.response;
  try {
    const body = await request.json().catch(() => ({}));
    const action = norm(body.action).toLowerCase();
    const access = await token(env);
    const spreadsheetId = ssId(env);
    const stockValues = await valuesGet(access, spreadsheetId, `${STOCK_SHEET}!A1:D20000`);
    const stockRows = mapStock(stockValues);
    const { sku, namaBarang, qty } = validateCommon(body);
    const tanggal = norm(body.tanggal) || new Date().toISOString().slice(0, 10);
    if (action === 'masuk') {
      const from = norm(body.from || body.lokasi);
      const to = norm(body.to);
      const lokasi = to || from;
      if (!from) throw new Error('From wajib diisi');
      const masukRows = mapIn(await valuesGet(access, spreadsheetId, `${IN_SHEET}!A1:N20000`));
      if (duplicateRecent(masukRows, { tanggal, from, sku, qty })) return json({ success: false, message: 'Submit duplikat terdeteksi' }, 409);
      const statusBarang = norm(body.statusBarang || body.status);
      await valuesAppend(access, spreadsheetId, `${IN_SHEET}!A:N`, [tanggal, from, to, sku, namaBarang, qty, statusBarang, norm(body.pic), norm(body.keterangan), norm(body.noIseller), norm(body.netsuite), norm(body.keteranganLainnya), norm(body.lokasiSuratJalan), norm(body.stckoutReject)]);
      const hit = stockRows.find(r => key(r.sku, r.lokasi) === key(sku, lokasi));
      if (hit) await valuesUpdate(access, spreadsheetId, `${STOCK_SHEET}!A${hit.rowNumber}:D${hit.rowNumber}`, [[lokasi, sku, namaBarang || hit.namaBarang, Number(hit.qty || 0) + qty]]);
      else await valuesAppend(access, spreadsheetId, `${STOCK_SHEET}!A:D`, [lokasi, sku, namaBarang, qty]);
      serverBarangRejectCache = null;
      return json({ success: true, message: 'Barang masuk reject berhasil disimpan' });
    }
    if (action === 'keluar') {
      const from = norm(body.from);
      if (!from) throw new Error('From/Lokasi wajib diisi');
      const hit = stockRows.find(r => key(r.sku, r.lokasi) === key(sku, from));
      if (!hit) throw new Error('Stok SKU di lokasi asal tidak ditemukan');
      const nextQty = Number(hit.qty || 0) - qty;
      if (nextQty < 0) throw new Error(`Stok tidak boleh minus. Stok tersedia: ${hit.qty}`);
      const keluarRows = mapOut(await valuesGet(access, spreadsheetId, `${OUT_SHEET}!A1:N20000`));
      if (duplicateRecent(keluarRows, { tanggal, from, sku, qty })) return json({ success: false, message: 'Submit duplikat terdeteksi' }, 409);
      const statusBarang = norm(body.statusBarang || body.status) || 'Reject Keluar';
      const statusProses = norm(body.statusProses) || statusBarang;
      await valuesAppend(access, spreadsheetId, `${OUT_SHEET}!A:N`, [tanggal, from, norm(body.to), sku, namaBarang || hit.namaBarang, qty, statusBarang, norm(body.pic), norm(body.keterangan), norm(body.noIseller), norm(body.netsuite), norm(body.keteranganLainnya), statusProses, norm(body.lokasiSuratJalan)]);
      await valuesUpdate(access, spreadsheetId, `${STOCK_SHEET}!A${hit.rowNumber}:D${hit.rowNumber}`, [[hit.lokasi, hit.sku, hit.namaBarang, nextQty]]);
      serverBarangRejectCache = null;
      return json({ success: true, message: 'Barang keluar reject berhasil disimpan' });
    }
    return json({ success: false, message: 'action tidak valid' }, 400);
  } catch (err) {
    return json({ success: false, message: err?.message || 'Internal server error' }, 400);
  }
}
