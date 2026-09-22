import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';

const SOURCES = Object.freeze({
  barangMasukVersion: 'inventory_barang_masuk',
  barangKeluarVersion: 'inventory_barang_keluar',
  kartuStokVersion: 'inventory_kartu_stok',
  rplVersion: 'inventory_rpl',
  bulkyVersion: 'inventory_bulky',
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

async function sourceVersion(config, table) {
  // One row plus an exact count detects inserts/deletes; synced_at detects edits.
  const response = await fetch(`${config.url}/rest/v1/${table}?select=synced_at&order=synced_at.desc.nullslast&limit=1`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Prefer: 'count=exact' },
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok) throw new Error(rows?.message || `${table} HTTP ${response.status}`);
  const count = String(response.headers.get('content-range') || '').split('/')[1] || '0';
  return `${rows?.[0]?.synced_at || 'unsynced'}:${count}`;
}

export async function handleInventoryVersionRequest({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try {
    const config = getSecretSupabaseConfig(env);
    const entries = await Promise.all(Object.entries(SOURCES).map(async ([name, table]) => [name, await sourceVersion(config, table)]));
    const versions = Object.fromEntries(entries);
    return json({ ...versions, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[InventoryVersion]', error?.message || error);
    return json({ success: false, message: 'Gagal memuat versi inventory.' }, 502);
  }
}

export function onRequestGet(context) {
  return handleInventoryVersionRequest(context);
}
