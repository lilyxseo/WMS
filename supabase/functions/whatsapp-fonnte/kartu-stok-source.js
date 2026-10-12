import { GoogleAccessError } from './google-errors.js';

export function kartuStokCandidates(env) {
  if (env.SHEET_ID_KARTU_STOK) return [{ id: env.SHEET_ID_KARTU_STOK, label: 'SHEET_ID_KARTU_STOK' }];
  const seen = new Set();
  return ['SHEET_ID_INVENTORY', 'SHEET_ID_2026'].flatMap(label => {
    const id = env[label];
    if (!id || seen.has(id)) return [];
    seen.add(id); return [{ id, label }];
  });
}

export async function readKartuStock(env, read) {
  for (const { id, label } of kartuStokCandidates(env)) {
    try { return await read(id, "'Kartu Stock'!A:AZ", label); }
    catch (error) {
      // Only a missing tab permits legacy fallback; permission/auth failures must remain visible.
      if (!(error instanceof GoogleAccessError) || error.code !== 'SHEET_TAB_MISSING') throw error;
    }
  }
  throw new GoogleAccessError('KARTU_STOK_SOURCE_MISSING', 'Tab Kartu Stock belum ditemukan. Isi SHEET_ID_KARTU_STOK dengan ID spreadsheet yang berisi Kartu Stock, lalu kirim cek google.', false);
}
