import { requirePicRole } from './_authz.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const CONFIG_ERROR = 'Spreadsheet Import PDF belum dikonfigurasi.';
const BATCH_SIZE = 500;
let importInProgress = false;

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
function clean(value) { return String(value ?? '').trim(); }
function parseConfig(value) { if (!value) return {}; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return {}; } }

export function normalizeTransferNumber(value) { return clean(value); }
export function validateSheetName(value) {
  const name = normalizeTransferNumber(value);
  if (!name) return { valid: false, message: 'Nomor Transfer belum tersedia.' };
  if (name.length > 100) return { valid: false, message: 'Nomor Transfer maksimal 100 karakter untuk nama sheet.' };
  if (/[\\/:?*\[\]]/.test(name)) return { valid: false, message: 'Nomor Transfer mengandung karakter yang tidak diizinkan Google Sheets: \\ / : ? * [ ]' };
  return { valid: true, name };
}

export async function resolveImportPdfSpreadsheetId(env = {}) {
  const importConfig = parseConfig(env.IMPORT_PDF_CONFIG || env.IMPORT_PDF_SETTINGS);
  const mapping = parseConfig(env.SHEET_MAPPING || env.SHEET_MAPPINGS);
  const candidates = [[importConfig.spreadsheetId || env.IMPORT_PDF_SPREADSHEET_ID, 'settings'], [env.SHEET_ID_INVENTORY || env.SHEET_ID_2026, 'application-default'], [mapping.importPdf?.spreadsheetId || mapping.import_pdf?.spreadsheetId || mapping.importPdfSpreadsheetId, 'sheet-mapping'], [env.GOOGLE_SHEET_ID_IMPORT_PDF, 'environment-fallback']];
  const found = candidates.find(([id]) => clean(id));
  return found ? { spreadsheetId: clean(found[0]), source: found[1] } : { spreadsheetId: '', source: 'none' };
}

function devLog(env, message) { const mode = clean(env.CONTEXT || env.NETLIFY_CONTEXT || env.NODE_ENV).toLowerCase(); if (['dev', 'development', 'local'].includes(mode)) console.info(`[ImportPDF] ${message}`); }
function base64Url(input) { const bytes = new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input)); let binary = ''; bytes.forEach(b => binary += String.fromCharCode(b)); return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function pemToArrayBuffer(pem) { const raw = clean(pem).replace(/\\n/g, '\n').replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, ''); const binary = atob(raw); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes.buffer; }
async function createAccessToken(env) { const now = Math.floor(Date.now() / 1000); const unsignedJwt = `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url({ iss: env.GOOGLE_CLIENT_EMAIL, scope: SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now })}`; const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsignedJwt)); let sig = ''; new Uint8Array(signature).forEach(b => sig += String.fromCharCode(b)); const jwt = `${unsignedJwt}.${btoa(sig).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`; const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) }); const data = await res.json(); if (!res.ok || !data.access_token) throw Object.assign(new Error(data.error_description || data.error || 'Gagal membuat access token'), { status: res.status }); return data.access_token; }

async function googleRequest(url, access, options = {}) { const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${access}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); const data = await res.json().catch(() => ({})); if (!res.ok) throw Object.assign(new Error(data.error?.message || 'Google Sheets request gagal'), { status: res.status }); return data; }
async function loadSheets(access, spreadsheetId) { const data = await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, access); return (data.sheets || []).map(s => s.properties); }
function normalizeQty(value) { const raw = clean(value).replace(/\./g, '').replace(',', '.'); if (!raw) return { ok: false, reason: 'Jumlah/Qty kosong' }; const qty = Number(raw); return Number.isNaN(qty) ? { ok: false, reason: 'Jumlah/Qty wajib angka' } : { ok: true, qty }; }
function validateTransferItems(items) { const valid = [], failed = []; for (let i = 0; i < items.length; i++) { const row = items[i] || {}, reasons = [], sku = clean(row.sku), qty = normalizeQty(row.qty); if (!sku) reasons.push('SKU wajib ada'); if (!qty.ok) reasons.push(qty.reason); const empty = !sku && !['namaProduk', 'qty', 'diterima', 'batal', 'tolak', 'catatan'].some(k => clean(row[k])); if (empty) continue; if (reasons.length) failed.push({ rowNumber: i + 1, reason: reasons.join(', ') }); else valid.push({ sku, namaProduk: clean(row.namaProduk), qty: qty.qty, diterima: clean(row.diterima), batal: clean(row.batal), tolak: clean(row.tolak), catatan: clean(row.catatan) }); } return { valid, failed }; }
function apiError(error) { if (error?.status === 429) return json({ success: false, message: 'Batas request Google Sheets tercapai. Coba beberapa saat lagi.' }, 429); if ([401, 403].includes(error?.status)) return json({ success: false, message: 'Akun aplikasi tidak memiliki akses ke spreadsheet tujuan.' }, 403); return json({ success: false, message: error?.message || 'Internal server error' }, error?.status >= 400 ? error.status : 500); }

export async function onRequestGet({ request, env }) {
  const authz = await requirePicRole({ request, env }); if (!authz.ok) return authz.response;
  const config = await resolveImportPdfSpreadsheetId(env);
  return config.spreadsheetId ? json({ success: true, configured: true }) : json({ success: false, configured: false, message: CONFIG_ERROR }, 500);
}

export async function onRequestPost({ request, env }) {
  const authz = await requirePicRole({ request, env }); if (!authz.ok) return authz.response;
  if (importInProgress) return json({ success: false, message: 'Import lain sedang berjalan. Tunggu hingga selesai.' }, 409);
  importInProgress = true;
  let createdSheetId = null, access, spreadsheetId, sheetName;
  try {
    const body = await request.json();
    const nameCheck = validateSheetName(body.transferNumber);
    if (!nameCheck.valid) return json({ success: false, message: nameCheck.message }, 400);
    sheetName = nameCheck.name;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const { valid, failed } = validateTransferItems(rows);
    if (failed.length || !valid.length) return json({ success: false, message: 'Data hasil PDF belum valid untuk diimport.', failedRows: failed }, 400);
    const config = await resolveImportPdfSpreadsheetId(env); spreadsheetId = config.spreadsheetId;
    if (!spreadsheetId) return json({ success: false, message: CONFIG_ERROR }, 500);
    access = await createAccessToken(env);
    const existing = (await loadSheets(access, spreadsheetId)).find(s => clean(s.title) === sheetName);
    if (existing) return json({ success: false, code: 'TRANSFER_ALREADY_EXISTS', message: `Transfer ${sheetName} sudah pernah dibuat.`, sheetName, sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${existing.sheetId}` }, 409);
    let created;
    try { created = await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, access, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }) }); }
    catch (error) { throw Object.assign(new Error(`Gagal membuat sheet ${sheetName}.`), { status: error.status }); }
    createdSheetId = created.replies?.[0]?.addSheet?.properties?.sheetId;
    const header = body.header || {};
    const values = [['Nomor Transfer', sheetName], ['Dari', clean(header.from ?? header.dari)], ['Kepada', clean(header.to ?? header.kepada)], ['Nomor Referensi', clean(header.referenceNumber ?? header.nomorReferensi)], [], ['SKU', 'Nama Produk', 'Jumlah', 'Diterima', 'Batal', 'Tolak', 'Catatan'], ...valid.map(r => [r.sku, r.namaProduk, r.qty, r.diterima, r.batal, r.tolak, r.catatan])];
    const chunks = []; for (let i = 0; i < values.length; i += BATCH_SIZE) chunks.push(values.slice(i, i + BATCH_SIZE));
    for (let i = 0, start = 1; i < chunks.length; i++) { const chunk = chunks[i], range = `'${sheetName.replace(/'/g, "''")}'!A${start}:G${start + chunk.length - 1}`; await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, access, { method: 'PUT', body: JSON.stringify({ values: chunk }) }); start += chunk.length; }
    const totalQty = valid.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    devLog(env, `created ${sheetName}: ${valid.length} rows in ${chunks.length} batches`);
    return json({ success: true, sheetName, importedRows: valid.length, totalQty, batchCount: chunks.length, sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${createdSheetId}` });
  } catch (error) {
    if (createdSheetId != null && access && spreadsheetId) { try { await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, access, { method: 'POST', body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: createdSheetId } }] }) }); } catch (cleanupError) { devLog(env, `rollback gagal untuk ${sheetName}: ${cleanupError.message}`); } return error?.status === 429 ? json({ success: false, message: 'Batas request Google Sheets tercapai. Coba beberapa saat lagi.' }, 429) : json({ success: false, message: 'Sheet berhasil diproses tetapi data gagal diimport.' }, 500); }
    return apiError(error);
  } finally { importInProgress = false; }
}
