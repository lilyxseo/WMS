import { getGoogleAccessToken } from './_google-auth.js';
import { getRequestRole } from './_authz.js';
import {rejectDate} from './_reject-entry.js';
const REJECT_SPREADSHEET_ID = '1BVGcIWnYqrG-DefzmnO_hZjNn3H3c4sriI7CBAWsxw8';
const STOCK_SHEET = 'KARTU STOCK KST';
const IN_SHEET = 'Barang Masuk';
const OUT_SHEET = 'Barang Keluar';
const SERVER_CACHE_TTL_MS = 5 * 60 * 1000;
let serverBarangRejectCache = null;
let serverBarangRejectLoading = null;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function token(env) { return getGoogleAccessToken(env); }
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
async function valuesGet(access, spreadsheetId, range,unformatted=false) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}${unformatted?'?valueRenderOption=UNFORMATTED_VALUE':''}`, { headers: { Authorization: `Bearer ${access}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Gagal membaca ${range}`);
  return Array.isArray(data.values) ? data.values : [];
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
    tanggal: rejectDate(r[0]),
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
    valuesGet(access, spreadsheetId, `${STOCK_SHEET}!A:D`,true),
    valuesGet(access, spreadsheetId, `${IN_SHEET}!A:N`,true),
    valuesGet(access, spreadsheetId, `${OUT_SHEET}!A:N`,true),
  ]);
  return { stock: mapStock(stockValues), masuk: mapIn(inValues), keluar: mapOut(outValues) };
}
export function invalidateRejectCache(){serverBarangRejectCache=null;}
export async function onRequestGet({ request, env }) {
  if(!await getRequestRole(request,env))return json({success:false,message:'Silakan login kembali.'},401);
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
export async function onRequestPost(){return json({success:false,message:'Gunakan Form Input Reject untuk menyimpan transaksi.'},410);}
