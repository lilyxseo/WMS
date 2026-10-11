// Keep normalization consistent with the WMS sync engine.
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const SMART_DASH = /[\u2010-\u2015\u2212]/g;
export function normalizeText(value) {
  return (value == null ? '' : String(value)).normalize('NFC').replace(ZERO_WIDTH, '').trim();
}
export function normalizeSku(value) { return normalizeText(value).replace(SMART_DASH, '-'); }
export function normalizeLocation(value) {
  let clean = normalizeText(value);
  try { clean = decodeURIComponent(clean); } catch (_error) { /* retain malformed URI text */ }
  return normalizeText(clean).replace(SMART_DASH, '-').replace(/\s+/g, ' ').toUpperCase();
}
export function normalizeNumber(value) {
  if (value == null || normalizeText(value) === '') return { valid: true, value: null };
  if (typeof value === 'number') return Number.isFinite(value) ? { valid: true, value } : { valid: false };
  const raw = normalizeText(value);
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw)) return { valid: false };
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? { valid: true, value: parsed } : { valid: false };
}
export function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return { valid: true, value: null };

  let year, month, day;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    [, year, month, day] = match;
  } else {
    // Movement endpoints write dates to these sheets as M/D/YYYY.
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (!match) return { valid: false };
    [, month, day, year] = match;
  }

  const yearNumber = Number(year), monthNumber = Number(month), dayNumber = Number(day);
  const parsed = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (parsed.getUTCFullYear() !== yearNumber || parsed.getUTCMonth() !== monthNumber - 1 || parsed.getUTCDate() !== dayNumber) {
    return { valid: false };
  }
  return { valid: true, value: `${String(yearNumber).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}` };
}
