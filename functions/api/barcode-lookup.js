import { getRequestRole } from './_authz.js';
import { token as getGoogleAccessToken } from './_barang-ops.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

const DEFAULT_SPREADSHEET_ID = '1KzOcV1V4bcxfsLzhfwXxnIxxZoTRlKh4UYhNizREpCM';
const SKU_PATTERN = /^\d{8,20}$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export function normalizeBarcode(value) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim(); }
function quoteQueryValue(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function barcodeColumns(env) {
  const configured = String(env.BARCODE_LOOKUP_COLUMNS || 'B').split(',').map(column => column.trim().toUpperCase()).filter(column => /^[A-Z]{1,2}$/.test(column) && column !== 'A');
  return [...new Set(configured.length ? configured : ['B'])];
}
export function buildExactLookupQuery(value, columns) {
  const exact = quoteQueryValue(value);
  return `select A where ${columns.map(column => `${column} = ${exact}`).join(' or ')} limit 1`;
}
export function buildNumericLookupQuery(value, columns) {
  if (!/^[1-9]\d*$/.test(value)) return '';
  return `select A where ${columns.map(column => `${column} = ${value}`).join(' or ')} limit 1`;
}
export function parseVisualizationResponse(text) {
  const match = String(text || '').match(/google\.visualization\.Query\.setResponse\((.*)\);?\s*$/s);
  if (!match) throw new Error('Respons barcode master tidak valid');
  const payload = JSON.parse(match[1]);
  if (payload.status === 'error') throw new Error(payload.errors?.[0]?.detailed_message || 'Query barcode master gagal');
  return String(payload.table?.rows?.[0]?.c?.[0]?.v ?? '').trim();
}
async function queryBarcodeMaster({ env, accessToken, query }) {
  const spreadsheetId = String(env.BARCODE_SPREADSHEET_ID || env.GOOGLE_SHEET_ID || DEFAULT_SPREADSHEET_ID).trim();
  const url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq`);
  url.searchParams.set('sheet', String(env.BARCODE_SHEET_NAME || 'BARCODE').trim());
  url.searchParams.set('headers', '1'); url.searchParams.set('tqx', 'out:json'); url.searchParams.set('tq', query);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Barcode master HTTP ${response.status}`);
  return parseVisualizationResponse(body);
}
async function resolveBarcodeMapping({ env, accessToken, barcode }) {
  const columns = barcodeColumns(env);
  const queries = [buildNumericLookupQuery(barcode, columns), buildExactLookupQuery(barcode, columns)].filter(Boolean);
  let successfulQuery = false;
  let lastError;
  for (const query of queries) {
    try {
      const sku = await queryBarcodeMaster({ env, accessToken, query });
      successfulQuery = true;
      if (sku) return sku;
    } catch (error) {
      // Visualization columns may be inferred as either number or string. A
      // type-mismatched query can fail, so try the other exact literal type.
      lastError = error;
    }
  }
  if (!successfulQuery && lastError) throw lastError;
  return '';
}
async function findExactInventorySku(env, sku) {
  const config = getSecretSupabaseConfig(env);
  const tables = ['inventory_kartu_stok', 'inventory_rpl', 'inventory_bulky', 'inventory_barang_masuk', 'inventory_barang_keluar'];
  for (const table of tables) {
    const url = `${config.url}/rest/v1/${table}?select=sku&sku=eq.${encodeURIComponent(sku)}&limit=1`;
    const response = await fetch(url, { headers: { apikey: config.key, Authorization: `Bearer ${config.key}` } });
    const rows = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`SKU lookup HTTP ${response.status}`);
    if (Array.isArray(rows) && rows.length) return String(rows[0].sku ?? sku).trim();
  }
  return '';
}
export async function handleBarcodeLookupRequest({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ found: false, message: 'Sesi tidak valid' }, 401);
  const barcode = normalizeBarcode(new URL(request.url).searchParams.get('barcode'));
  if (!barcode) return json({ found: false, message: 'Barcode wajib diisi' }, 400);
  try {
    const accessToken = await getGoogleAccessToken(env);
    const sku = await resolveBarcodeMapping({ env, accessToken, barcode });
    if (sku) return json({ found: true, sku });
    if (SKU_PATTERN.test(barcode)) {
      const exactSku = await findExactInventorySku(env, barcode);
      if (exactSku) return json({ found: true, sku: exactSku });
    }
    return json({ found: false });
  } catch (error) {
    console.error('[BarcodeLookup]', error?.message || error);
    return json({ found: false, message: 'Gagal mencari barcode' }, 502);
  }
}
export function onRequestGet(context) { return handleBarcodeLookupRequest(context); }
