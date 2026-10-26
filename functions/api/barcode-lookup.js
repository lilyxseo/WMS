import {normalizeScanValue} from '../../assets/js/utils/scan-value.js';
import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

const BARCODE_TABLE = 'inventory_barcode';
const BARCODE_COLUMNS = 'barcode,sku';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function normalizedBarcode(value) {
  return normalizeScanValue(value);
}

function diagnostic(message, details) {
  if (details === undefined) console.info(`[BarcodeLookup] ${message}`);
  else console.info(`[BarcodeLookup] ${message}`, details);
}

export async function handleBarcodeLookupRequest({ request, env }) {
  const startedAt = Date.now();
  diagnostic('request received');
  try {
    const role = await getRequestRole(request, env);
    if (!role) {
      diagnostic('error code/message', { code: 'UNAUTHORIZED', message: 'Invalid or missing session' });
      return json({ success: false, error: 'UNAUTHORIZED' }, 401);
    }
    diagnostic('auth ok');

    const barcode = normalizedBarcode(new URL(request.url).searchParams.get('barcode'));
    if (!barcode || barcode.length > 128) {
      diagnostic('error code/message', { code: 'INVALID_BARCODE', message: 'Barcode is missing or too long' });
      return json({ success: false, error: 'INVALID_BARCODE' }, 400);
    }
    diagnostic('normalized barcode');

    const config = getSecretSupabaseConfig(env);
    const query = new URL(`${config.url}/rest/v1/${BARCODE_TABLE}`);
    query.searchParams.set('select', BARCODE_COLUMNS);
    query.searchParams.set('barcode', `eq.${barcode}`);
    query.searchParams.set('limit', '2');
    diagnostic('db query start');
    const response = await fetch(query, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
      signal:AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload)) {
      const error = new Error(payload?.message || `Supabase HTTP ${response.status}`);
      error.code = payload?.code || 'SUPABASE_QUERY_FAILED';
      throw error;
    }
    const rows = Array.isArray(payload) ? payload : [];
    diagnostic('db query result count', { count: rows.length });
    const mapped=[...new Set(rows.map(row=>String(row.sku??'').trim()).filter(Boolean))];
    if(mapped.length>1)return json({success:false,error:'BARCODE_AMBIGUOUS'},409);
    if(mapped.length===1)return json({success:true,found:true,sku:mapped[0]});
    // The label may encode the SKU itself, rather than a separate product barcode.
    // Exact identifiers only: never cast to numbers or strip SKU prefixes/suffixes.
    const tables=['inventory_kartu_stok','inventory_rpl','inventory_bulky','inventory_barang_masuk','inventory_barang_keluar','inventory_barcode'];
    const candidates=[...new Set([barcode,barcode.toUpperCase()])];
    for(const candidate of candidates){
      const results=await Promise.allSettled(tables.map(async table=>{
        const url=new URL(`${config.url}/rest/v1/${table}`);url.searchParams.set('select','sku');url.searchParams.set('sku',`eq.${candidate}`);url.searchParams.set('limit','1');
        const res=await fetch(url,{headers:{apikey:config.key,Authorization:`Bearer ${config.key}`},signal:AbortSignal.timeout(10000)}),data=await res.json();
        if(!res.ok||!Array.isArray(data))throw Error('SKU lookup unavailable');return data;
      }));
      const sku=results.filter(item=>item.status==='fulfilled').flatMap(item=>item.value).map(row=>String(row.sku??'').trim()).find(Boolean);
      if(sku)return json({success:true,found:true,sku});
      if(results.some(item=>item.status==='rejected'))throw Error('SKU lookup unavailable');
    }
    return json({success:true,found:false});
  } catch (error) {
    console.error('[BarcodeLookup] error code/message', {
      code: String(error?.code || 'BARCODE_LOOKUP_FAILED'),
      message: String(error?.message || 'Unknown error'),
    });
    return json({ success: false, error: 'BARCODE_LOOKUP_FAILED' }, 500);
  } finally {
    diagnostic('totalMs', { totalMs: Date.now() - startedAt });
  }
}

export function onRequestGet(context) {
  return handleBarcodeLookupRequest(context);
}
