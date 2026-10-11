const SAFE_FIELD = /^[a-z][a-z0-9_]*$/;

/** Normalize all inventory searches without ever coercing identifiers to numbers. */
export function normalizeSearchQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id');
}

export function inventorySearchTokens(value) {
  return normalizeSearchQuery(value).split(' ').filter(Boolean);
}

/** Commas separate alternatives; spaces still combine words within each alternative. */
export function inventorySearchGroups(value) {
  return [...new Set(normalizeSearchQuery(value).split(',').map(part => part.trim()).filter(Boolean))];
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
  const groups = inventorySearchGroups(value);
  if (!groups.length && normalizeSearchQuery(value)) throw new TypeError('Isi kata pencarian di antara tanda koma.');
  const clauses = query => inventorySearchTokens(query).map(token => {
    const pattern = encodeURIComponent(`*${escapeLike(token)}*`);
    return `or=(${safeFields.map(field => `${field}.ilike.${pattern}`).join(',')})`;
  });
  if (groups.length <= 1) return clauses(groups[0] || '');
  const alternatives = groups.map(query => {
    const tokens = clauses(query).map(clause => clause.replace(/^or=/, 'or'));
    return tokens.length > 1 ? `and(${tokens.join(',')})` : tokens[0];
  });
  return [`or=(${alternatives.join(',')})`];
}

export function buildInventorySearchQuery(value, fields) {
  const filters = buildInventorySearchFilters(value, fields);
  // PostgREST must receive a single logical tree; duplicate `or` parameters
  // can lose earlier tokens depending on the request parser.
  if (filters.length > 1) return `&and=(${filters.map(filter => filter.replace(/^or=/, 'or')).join(',')})`;
  return filters.length ? `&${filters[0]}` : '';
}
