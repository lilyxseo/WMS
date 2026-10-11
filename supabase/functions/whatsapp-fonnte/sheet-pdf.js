import { googleToken } from './sheet-edit.js';
import { GoogleAccessError, googleResponseError } from './google-errors.js';
import { transferName, validateTransferRows } from './pdf-document.js';

export async function commitPdfImport(env, state, fetchFn) {
  const title = transferName(state.header.transferNumber), rows = validateTransferRows(state.rows);
  if (!env.SHEET_ID_INVENTORY) throw new GoogleAccessError('PDF_NOT_CONFIGURED', 'SHEET_ID_INVENTORY belum dikonfigurasi.');
  let writing = false;
  try {
    const token = await googleToken(env, fetchFn);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID_INVENTORY)}`;
    const metadata = await fetchFn(`${base}?fields=sheets.properties`, { headers, signal: AbortSignal.timeout(15000) });
    if (!metadata.ok) throw await googleResponseError(metadata, false, 'SHEET_ID_INVENTORY');
    const sheets = (await metadata.json()).sheets;
    if (!Array.isArray(sheets)) throw new Error('Invalid spreadsheet metadata');
    if (sheets.some(sheet => String(sheet.properties?.title).trim().toLowerCase() === title.toLowerCase())) {
      return { duplicate: true, reply: `Sheet ${title} sudah tersedia di Inventory. Data tidak diubah. Periksa sheet sebelum import ulang.` };
    }
    const occupied = new Set(sheets.map(sheet => sheet.properties?.sheetId));
    let sheetId;
    do { sheetId = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff; } while (occupied.has(sheetId));
    const values = [['Nomor Transfer', title], ['Dari', state.header.from || ''], ['Kepada', state.header.to || ''], ['Nomor Referensi', state.header.referenceNumber || ''], [], ['SKU','Nama Produk','Jumlah','Diterima','Batal','Tolak','Catatan'], ...rows.map(row => [row.sku,row.namaProduk,row.qty,String(row.diterima || ''),String(row.batal || ''),String(row.tolak || ''),String(row.catatan || '')])];
    const cell = value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value) } });
    // Google applies the entire batch atomically: no empty tab is left after a rejected write.
    const requests = [
      { addSheet: { properties: { sheetId, title, gridProperties: { rowCount: Math.max(100, values.length), columnCount: 7, frozenRowCount: 6 } } } },
      { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: values.map(row => ({ values: row.map(cell) })), fields: 'userEnteredValue' } },
      { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.12, green: 0.25, blue: 0.4 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'userEnteredFormat' } },
      { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 7 } } },
    ];
    writing = true;
    const response = await fetchFn(`${base}:batchUpdate`, { method: 'POST', headers, body: JSON.stringify({ requests }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw await googleResponseError(response, true, 'SHEET_ID_INVENTORY');
    const data = await response.json();
    if (data.replies?.[0]?.addSheet?.properties?.sheetId !== sheetId) throw new Error('Import not confirmed');
    return { saved: true, sheetId, sheetName: title, importedRows: rows.length, totalQty: rows.reduce((sum,row) => sum + row.qty, 0) };
  } catch (error) {
    if (error instanceof GoogleAccessError) throw error;
    throw new GoogleAccessError('PDF_GOOGLE_FAILED', writing ? 'Import belum terkonfirmasi. Periksa sheet Inventory sebelum mengulang.' : 'Koneksi Google gagal sebelum import. Balas ulang untuk mencoba dengan preview yang sama.', writing);
  }
}
