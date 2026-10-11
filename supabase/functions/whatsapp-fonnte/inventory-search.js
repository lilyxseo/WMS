const SAFE_FIELD = /^[a-z][a-z0-9_]*$/;

/** Normalize all inventory searches without ever coercing identifiers to numbers. */
export function normalizeSearchQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id');
}

export function inventorySearchTokens(value) {
  return normalizeSearchQuery(value).split(' ').filter(Boolean);
}

function escapeLike(value) {
  return String(value).replace(/[\\%_*(),.]/g, character => `\\${character}`);
}

/**
 * Build PostgREST filters with AND between words and OR between user-facing
 * inventory fields. Field names are server-owned and strictly allowlisted.
 */
export function buildInventorySearchFilters(value, fields = ['sku', 'nama_barang', 'lokasi']) {
  const safeFields = [...new Set(fields)].filter(field => SAFE_FIELD.test(field));
  if (!safeFields.length) throw new TypeError('At least one safe inventory search field is required');
  return inventorySearchTokens(value).map(token => {
    const pattern = encodeURIComponent(`*${escapeLike(token)}*`);
    return `or=(${safeFields.map(field => `${field}.ilike.${pattern}`).join(',')})`;
  });
}

export function buildInventorySearchQuery(value, fields) {
  const filters = buildInventorySearchFilters(value, fields);
  return filters.length ? `&${filters.join('&')}` : '';
}
