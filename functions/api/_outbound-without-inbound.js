import { getSecretSupabaseConfig } from './_supabase-config.js';

export function mapOutboundWithoutInbound(rows = []) {
  return rows.map(row => ({
    type: 'OUTBOUND_WITHOUT_INBOUND',
    severity: 'High',
    sku: String(row?.sku ?? '').trim(),
    nama: String(row?.nama_barang ?? '-').trim() || '-',
    issue: 'Ada barang keluar, tetapi barang masuk belum tercatat.',
    source: 'Barang Keluar',
    recommendation: 'Periksa dan lengkapi data Barang Masuk.',
  })).filter(row => row.sku);
}

export async function loadOutboundWithoutInbound(env) {
  const config = getSecretSupabaseConfig(env);
  const response = await fetch(`${config.url}/rest/v1/rpc/inventory_outbound_without_inbound`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Supabase warning RPC failed (${response.status})`);
  if (!Array.isArray(payload)) throw new TypeError('Supabase warning RPC returned an invalid response');
  return mapOutboundWithoutInbound(payload);
}
