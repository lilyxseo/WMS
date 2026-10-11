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
    if (error instanceof GoogleAccessError) error.userMessage += `\nTahap: membaca ${tab || 'range'} (${label}), range ${range}.`;
    throw error;
  }
}

// Extend only the row capacity when the selected transaction row is outside the grid.
async function readTransactionRowInternal({ id, sheet, rowNumber, label, headers, fetchFn }) {
  const range = `'${sheet}'!A${rowNumber}:I${rowNumber}`;
  const read = () => readSheetValues({ id, range, label, render: 'FORMATTED_VALUE', headers, fetchFn });
  try { return await read(); }
  catch (error) {
    if (!(error instanceof GoogleAccessError) || error.code !== 'SHEETS_GRID_LIMIT') throw error;
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
    const metadata = await fetchFn(`${base}?fields=sheets.properties(sheetId,title,gridProperties)`, { headers, signal: AbortSignal.timeout(15000) });
    if (!metadata.ok) throw await googleResponseError(metadata, false, label);
    const properties = (await metadata.json()).sheets?.find(tab => tab.properties?.title === sheet)?.properties;
    const grid = properties?.gridProperties;
    if (!grid || !Number.isInteger(properties.sheetId) || !Number.isInteger(grid.rowCount) || grid.rowCount < 1 || grid.columnCount < 9) throw error;
    if (rowNumber > grid.rowCount) {
      const response = await fetchFn(`${base}:batchUpdate`, {
        method: 'POST', headers, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ requests: [{ appendDimension: { sheetId: properties.sheetId, dimension: 'ROWS', length: rowNumber - grid.rowCount } }] }),
      });
      // No transaction values have been written at this stage.
      if (!response.ok) throw await googleResponseError(response, false, label);
    }
    return await read();
  }
}

// Find the first available transaction row without reading the entire history at once.
async function findTransactionSlotInternal({ id, sheet, label, headers, fetchFn }) {
  const batchSize = 500;
  let header = [], gridRows;
  for (let start = 1; ; start += batchSize) {
    if (gridRows && start > gridRows) return { header, rowNumber: start };
    let end = Math.min(start + batchSize - 1, gridRows || Infinity);
    const read = () => readSheetValues({ id, range: `'${sheet}'!A${start}:I${end}`, label, headers, fetchFn });
    let rows;
    try { rows = await read(); }
    catch (error) {
      if (!(error instanceof GoogleAccessError) || error.code !== 'SHEETS_GRID_LIMIT') throw error;
      const response = await fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties(title,gridProperties)`, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw await googleResponseError(response, false, label);
      const properties = (await response.json()).sheets?.find(tab => tab.properties?.title === sheet)?.properties;
      if (!Number.isInteger(properties?.gridProperties?.rowCount) || properties.gridProperties.rowCount < 1 || properties.gridProperties.columnCount < 9) throw error;
      gridRows = properties.gridProperties.rowCount;
      if (start > gridRows) return { header, rowNumber: start };
      end = Math.min(end, gridRows); rows = await read();
    }
    if (start === 1) header = rows[0] || [];
    for (let index = start === 1 ? 1 : 0; index < rows.length; index++) {
      const row = rows[index] || [];
      if (String(row[0] ?? '').trim() === '' && String(row[3] ?? '').trim() === '') return { header, rowNumber: start + index };
    }
    if (rows.length < end - start + 1) return { header, rowNumber: Math.max(2, start + rows.length) };
    if (gridRows && end === gridRows) return { header, rowNumber: gridRows + 1 };
  }
}

export async function readTransactionRow(options) {
  try { return await readTransactionRowInternal(options); }
  catch (error) {
    if (error instanceof GoogleAccessError) throw error;
    throw new GoogleAccessError('SHEETS_ROW_CHECK_FAILED', `Pemeriksaan baris ${options.sheet} belum berhasil. Coba ulang nanti.`, false);
  }
}
export async function findTransactionSlot(options) {
  try { return await findTransactionSlotInternal(options); }
  catch (error) {
    if (error instanceof GoogleAccessError) throw error;
    throw new GoogleAccessError('SHEETS_SLOT_CHECK_FAILED', `Pemeriksaan baris tersedia ${options.sheet} belum berhasil. Coba ulang nanti.`, false);
  }
}
