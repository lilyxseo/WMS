import { GoogleAccessError, googleResponseError } from './google-errors.js';
import { googleToken } from './sheet-edit.js';
import { movementDates } from './sheet-movement.js';
import { displayText } from './menu.js';
import { normalizeLocation, normalizeSku, normalizeText, normalizeNumber } from './sheet-normalization.js';

export async function commitStock(env, state, fetchFn) {
  if (!['in', 'out'].includes(state.direction) || !Number.isFinite(state.qty) || state.qty <= 0 || !state.profile?.id || !normalizeText(state.profile.full_name) || !normalizeLocation(state.location) || !normalizeSku(state.row?.sku)) throw new Error('Invalid stock draft');
  let access;
  try { access = await googleToken(env, fetchFn); }
  catch (error) { if (error instanceof GoogleAccessError) throw error; throw new GoogleAccessError('GOOGLE_AUTH_FAILED', 'Autentikasi Google gagal. Periksa kredensial Google pada Supabase Secrets.', false); }
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID_2026)}`;
  const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };
  const read = async range => {
    let response;
    try { response = await fetchFn(`${base}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`, { headers, signal: AbortSignal.timeout(15000) }); }
    catch { throw new GoogleAccessError('SHEETS_READ_CONNECTION_FAILED', 'Koneksi baca Google Sheets gagal. Coba cek google kembali nanti.', false); }
    if (!response.ok) throw await googleResponseError(response);
    let payload;
    try { payload = await response.json(); }
    catch { throw new GoogleAccessError('SHEETS_INVALID_RESPONSE', 'Respons baca Google Sheets tidak valid. Coba cek google kembali nanti.', false); }
    return payload.values || [];
  };
  const stock = await read("'Kartu Stock'!A:Z");
  const header = (stock[0] || []).map(value => String(value).toUpperCase().replace(/\s/g, ''));
  const [locationIndex, skuIndex, nameIndex, qtyIndex] = ['LOKASIBULKY', 'SKU', 'NAMABARANG', 'STOKAKHIR'].map(name => header.indexOf(name));
  if ([locationIndex, skuIndex, nameIndex, qtyIndex].some(index => index < 0)) return 'Kolom Kartu Stok tidak sesuai WMS. Stock in/out tidak disimpan.';
  const skuRows = stock.slice(1).filter(row => normalizeSku(row[skuIndex]) === normalizeSku(state.row.sku));
  if (!skuRows.length || skuRows.some(row => normalizeText(row[nameIndex]) !== normalizeText(state.row.nama_barang))) return 'SKU/nama barang berubah di WMS. Transaksi tidak disimpan. Sinkronkan WMS lalu cari ulang.';
  if (state.direction === 'out') {
    const locationRows = skuRows.filter(row => normalizeLocation(row[locationIndex]) === normalizeLocation(state.location));
    const available = locationRows.length === 1 ? normalizeNumber(locationRows[0][qtyIndex]).value : undefined;
    if (!Number.isFinite(available) || available < state.qty || available !== state.available) return 'Stok asal berubah, tidak mencukupi, atau memiliki baris ganda. Stock out tidak disimpan. Sinkronkan WMS lalu mulai ulang.';
  }
  const inbound = state.direction === 'in';
  const sheet = inbound ? 'Barang Masuk' : 'Barang KeIuar';
  const expected = ['TANGGAL', 'FROM', 'TO', 'SKU', 'NAMABARANG', 'QTY', 'STATUS', 'PIC', 'KETERANGAN'];
  const destinationHeaders = (await read(`'${sheet}'!A1:I1`))[0] || [];
  if (expected.some((name, i) => String(destinationHeaders[i] || '').toUpperCase().replace(/\s/g, '') !== name)) return 'Kolom transaksi tidak sesuai WMS. Stock in/out tidak disimpan.';
  const dates = movementDates(new Date(), env.BUSINESS_TIME_ZONE || 'Asia/Jakarta');
  const status = inbound ? 'Barang Masuk' : 'Barang Keluar';
  // Only the warehouse location is requested. Counterparty locations remain blank.
  const values = [dates.sheetDate, inbound ? '' : state.location, inbound ? state.location : '', state.row.sku, state.row.nama_barang, state.qty, status, normalizeText(state.profile.full_name), `STOCK ${state.direction.toUpperCase()} WHATSAPP | WA:${state.nonce} | USER:${state.profile.id}`];
  const response = await fetchFn(`${base}/values/${encodeURIComponent(`'${sheet}'!A:I`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', headers, body: JSON.stringify({ values: [values] }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw await googleResponseError(response, true);
  return `✅ *Stock ${inbound ? 'In' : 'Out'} tersimpan*\nSKU: ${displayText(state.row.sku)}\nBarang: ${displayText(state.row.nama_barang)}\nLokasi: ${displayText(state.location)}\nQty: ${state.qty}\nPIC: ${displayText(state.profile.full_name)}\nTanggal: ${dates.date}\n\nSinkronkan WMS untuk memperbarui pencarian Supabase.\nReferensi: ${state.nonce}`;
}
