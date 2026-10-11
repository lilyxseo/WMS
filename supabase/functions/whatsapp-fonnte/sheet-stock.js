import { readSheetValues, readTransactionRow, findTransactionSlot } from './sheet-values.js';
import { parseKartuStockHeader, stockHeaderFailure } from './kartu-stok-header.js';
import { readKartuStock } from './kartu-stok-source.js';
import { GoogleAccessError, googleResponseError } from './google-errors.js';
import { googleToken } from './sheet-edit.js';
import { movementDates } from './sheet-movement.js';
import { displayText } from './menu.js';
import { normalizeLocation, normalizeSku, normalizeText, normalizeNumber } from './sheet-normalization.js';

export async function commitStock(env, state, fetchFn) {
  if (!['in', 'out'].includes(state.direction) || !Number.isFinite(state.qty) || state.qty <= 0 || !state.profile?.id || !normalizeLocation(state.location) || !normalizeText(state.pic) || (state.direction === 'in' && (!normalizeLocation(state.from) || !normalizeLocation(state.to))) || !normalizeSku(state.row?.sku)) throw new Error('Invalid stock draft');
  let access;
  try { access = await googleToken(env, fetchFn); }
  catch (error) { if (error instanceof GoogleAccessError) throw error; throw new GoogleAccessError('GOOGLE_AUTH_FAILED', 'Autentikasi Google gagal. Periksa kredensial Google pada Supabase Secrets.', false); }
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID_2026)}`;
  const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };
  const read = (range, render = 'FORMATTED_VALUE', sheetId = env.SHEET_ID_2026, secret = 'SHEET_ID_2026') => readSheetValues({ id: sheetId, range, render, label: secret, headers, fetchFn });
  const stock = await readKartuStock(env, (id, range, label) => read(range, 'FORMATTED_VALUE', id, label));
  const parsed = parseKartuStockHeader(stock);
  if (parsed.missing.length) return `${stockHeaderFailure(parsed)}\nStock in/out tidak disimpan.`;
  const [locationIndex, skuIndex, nameIndex, qtyIndex] = parsed.indices;
  const skuRows = stock.slice(parsed.headerIndex + 1).filter(row => normalizeSku(row[skuIndex]) === normalizeSku(state.row.sku));
  if (!skuRows.length || skuRows.some(row => normalizeText(row[nameIndex]) !== normalizeText(state.row.nama_barang))) return 'SKU/nama barang berubah di WMS. Transaksi tidak disimpan. Sinkronkan WMS lalu cari ulang.';
  if (state.direction === 'out') {
    const locationRows = skuRows.filter(row => normalizeLocation(row[locationIndex]) === normalizeLocation(state.location));
    const available = locationRows.length === 1 ? normalizeNumber(locationRows[0][qtyIndex]).value : undefined;
    if (!Number.isFinite(available) || available < state.qty || available !== state.available) return 'Stok asal berubah, tidak mencukupi, atau memiliki baris ganda. Stock out tidak disimpan. Sinkronkan WMS lalu mulai ulang.';
  }
  const inbound = state.direction === 'in';
  const sheet = inbound ? 'Barang Masuk' : 'Barang KeIuar';
  const expected = ['TANGGAL', 'FROM', 'TO', 'SKU', 'NAMABARANG', 'QTY', 'STATUS', 'PIC', 'KETERANGAN'];
  const destination = await findTransactionSlot({ id: env.SHEET_ID_2026, sheet, label: 'SHEET_ID_2026', headers, fetchFn });
  const destinationHeaders = destination.header;
  if (expected.some((name, i) => String(destinationHeaders[i] || '').toUpperCase().replace(/\s/g, '') !== name)) return 'Kolom transaksi tidak sesuai WMS. Stock in/out tidak disimpan.';
  const dates = movementDates(new Date(), env.BUSINESS_TIME_ZONE || 'Asia/Jakarta');
  const status = inbound ? 'Barang Masuk' : 'Barang Keluar';
  const from = inbound ? state.from : state.location, to = inbound ? state.to : '';
  const keterangan = inbound ? 'RECEIPT' : 'STOCK OUT WHATSAPP';
  const values = [dates.sheetDate, from, to, state.row.sku, state.row.nama_barang, state.qty, status, state.pic, keterangan];
  // Match WMS movement: Tanggal and SKU identify occupied transaction rows.
  // Use displayed values so formulas returning blank do not make template rows occupied.
  // Only A:I is written; auxiliary columns, chips and links remain untouched.
  const empty = row => normalizeText(row[0]) === '' && normalizeText(row[3]) === '';
  const rowNumber = destination.rowNumber;
  const range = `'${sheet}'!A${rowNumber}:I${rowNumber}`;
  const current = await readTransactionRow({ id: env.SHEET_ID_2026, sheet, rowNumber, label: 'SHEET_ID_2026', headers, fetchFn });
  if (!empty(current[0] || [])) return 'Baris tujuan sudah diisi oleh transaksi lain. Transaksi tidak disimpan. Mulai ulang setelah memeriksa WMS.';
  const response = await fetchFn(`${base}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { method: 'PUT', headers, body: JSON.stringify({ values: [values] }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw await googleResponseError(response, true);
  return { saved: true, rowNumber, from, to, keterangan, reply: `✅ *${inbound ? 'Inbound' : 'Outbount'} tersimpan*\nSKU: ${displayText(state.row.sku)}\nBarang: ${displayText(state.row.nama_barang)}\nFrom: ${displayText(from)}${inbound ? `\nTo: ${displayText(to)}` : ''}\nQty: ${state.qty}\nPIC: ${displayText(state.pic)}\nTanggal: ${dates.date}` };
}
