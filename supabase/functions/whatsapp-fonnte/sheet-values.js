import { GoogleAccessError, googleResponseError } from './google-errors.js';

function columnName(number) {
  let name = '';
  for (; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
  return name;
}

// Retry large whole-column reads using the tab's actual grid and bounded batches.
export async function readSheetValues({ id, range, label, render = 'FORMATTED_VALUE', headers, fetchFn }) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
  const tab = /^'([^']+)'!/.exec(range)?.[1];
  const read = async current => {
    let response;
    try { response = await fetchFn(`${base}/values/${encodeURIComponent(current)}?valueRenderOption=${render}`, { headers, signal: AbortSignal.timeout(15000) }); }
    catch { throw new GoogleAccessError('SHEETS_READ_CONNECTION_FAILED', 'Koneksi baca Google Sheets gagal. Coba cek google kembali nanti.'); }
    if (!response.ok) throw await googleResponseError(response, false, label);
    try { return (await response.json()).values || []; }
    catch { throw new GoogleAccessError('SHEETS_INVALID_RESPONSE', 'Respons baca Google Sheets tidak valid.'); }
  };
  try {
    try { return await read(range); }
    catch (error) {
      if (!(error instanceof GoogleAccessError) || !['SHEETS_GRID_LIMIT', 'SHEETS_READ_TOO_LARGE'].includes(error.code) || !/^'[^']+'!A:[A-Z]+$/.test(range)) throw error;
    }
    const response = await fetchFn(`${base}?fields=sheets.properties(title,gridProperties)`, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw await googleResponseError(response, false, label);
    const payload = await response.json();
    const grid = payload.sheets?.find(sheet => sheet.properties?.title === tab)?.properties?.gridProperties;
    if (!grid || !Number.isInteger(grid.rowCount) || grid.rowCount < 1 || !Number.isInteger(grid.columnCount) || grid.columnCount < 1) throw new GoogleAccessError('SHEETS_GRID_UNKNOWN', 'Batas tab Google Sheets belum dapat diperiksa.');
    const endColumn = range.split(':')[1];
    const requestedColumns = [...endColumn].reduce((count, letter) => count * 26 + letter.charCodeAt(0) - 64, 0);
    const lastColumn = columnName(Math.min(grid.columnCount, requestedColumns));
    const result = [];
    for (let start = 1; start <= grid.rowCount; start += 1000) {
      const end = Math.min(grid.rowCount, start + 999);
      const rows = await read(`'${tab}'!A${start}:${lastColumn}${end}`);
      // Keep row offsets, including empty gaps between batches.
      for (let offset = 0; offset <= end - start; offset++) result.push(rows[offset] || []);
    }
    while (result.length && result[result.length - 1].every(value => value === '' || value == null)) result.pop();
    return result;
  } catch (error) {
    if (error instanceof GoogleAccessError) error.userMessage += `\nTahap: membaca ${tab || 'range'} (${label}).`;
    throw error;
  }
}
