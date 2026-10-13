import { getSecretSupabaseConfig } from '../_supabase-config.js';
import { transactionPage } from '../_transaction-read.js';

const normalize = value => String(value ?? '').trim().toLowerCase();
const inFilter = values => `in.(${values.map(value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;

// Rows are ordered by the same normalized transaction date and same-day row
// tie-break as Barang Masuk. Never infer recency from quantity or TRIP location.
export async function fetchLastInboundLocations(env, skus = []) {
  const unique = [...new Set(skus.map(value => String(value ?? '').trim()).filter(Boolean))];
  if (!unique.length) return {};
  const config = getSecretSupabaseConfig(env);
  const locations = {};
  for (let offset = 0; offset < unique.length; offset += 100) {
    const params = new URLSearchParams({
      sku: inFilter(unique.slice(offset, offset + 100)),
      status: 'in.("Barang Masuk","Movement")',
      to_location: 'not.is.null',
    });
    const { rows } = await transactionPage(config, 'inventory_barang_masuk', {
      columns: 'sku,to_location,tanggal,source_row_number',
      filterQuery: `&${params}`, sort: 'latest', full: true,
    });
    for (const row of rows) {
      const sku = normalize(row.sku), location = String(row.to_location ?? '').trim();
      if (normalize(location).replace(/\s+/g, ' ') === 'masih di inbound') continue;
      if (sku && location && !Object.hasOwn(locations, sku)) locations[sku] = location;
    }
  }
  return locations;
}
