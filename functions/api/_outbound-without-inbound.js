import { getSecretSupabaseConfig } from './_supabase-config.js';

export function mapOutboundWithoutInbound(rows = []) {
  return rows.map(row => ({
    type: Number(row?.inbound_qty) > 0 ? 'OUTBOUND_EXCEEDS_INBOUND' : 'OUTBOUND_WITHOUT_INBOUND',
    severity: 'High',
    sku: String(row?.sku ?? '').trim(),
    nama: String(row?.nama_barang ?? '-').trim() || '-',
    issue: Number(row?.inbound_qty) > 0
      ? `Barang keluar ${Number(row.outbound_qty)} pcs, barang masuk ${Number(row.inbound_qty)} pcs (lebih ${Number(row.outbound_qty) - Number(row.inbound_qty)} pcs).`
      : 'Ada barang keluar, tetapi barang masuk belum tercatat.',
    source: Number(row?.inbound_qty) > 0 ? 'Barang Masuk/Barang Keluar' : 'Barang Keluar',
    recommendation: Number(row?.inbound_qty) > 0
      ? 'Periksa data Barang Masuk dan Barang Keluar.'
      : 'Periksa dan lengkapi data Barang Masuk.',
    detail: Number(row?.inbound_qty) > 0 ? {
      scope: 'Perbandingan kumulatif',
      inboundQty: Number(row.inbound_qty),
      outboundQty: Number(row.outbound_qty),
      difference: Number(row.outbound_qty) - Number(row.inbound_qty),
    } : undefined,
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
