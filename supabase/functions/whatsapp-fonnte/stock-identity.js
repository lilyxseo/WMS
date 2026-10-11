import { normalizeLocation, normalizeText } from './sheet-normalization.js';

const nameKey = value => normalizeText(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('id');

export function stockIdentity(rows, indices, state) {
  const [locationIndex, , nameIndex] = indices;
  const location = state.direction === 'out' ? state.location : state.row.lokasi_bulky;
  const selected = rows.filter(row => normalizeLocation(row[locationIndex]) === normalizeLocation(location));
  const candidates = selected.length ? selected : rows;
  const names = new Map();
  for (const row of candidates) {
    const key = nameKey(row[nameIndex]);
    if (key) names.set(key, normalizeText(row[nameIndex]));
  }
  const expected = nameKey(state.row.nama_barang);
  if (names.has(expected)) return { matches: true };
  if (names.size === 1) return { matches: false, name: [...names.values()][0] };
  return { matches: false };
}
