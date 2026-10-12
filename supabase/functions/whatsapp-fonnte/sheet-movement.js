import { readSheetValues, findTransactionSlot, readTransactionRow, readSheetPreview } from './sheet-values.js';
import { parseKartuStockHeader, stockHeaderFailure } from './kartu-stok-header.js';
import { readKartuStock } from './kartu-stok-source.js';
import { stockIdentity } from './stock-identity.js';
import { GoogleAccessError, googleResponseError } from './google-errors.js';
import { displayText } from './menu.js';
import { googleToken } from './sheet-edit.js';
import { normalizeLocation, normalizeSku, normalizeNumber, normalizeText } from './sheet-normalization.js';

export function movementDates(now = new Date(), timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = name => parts.find(part => part.type === name).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, sheetDate: `${Number(get('month'))}/${Number(get('day'))}/${get('year')}` };
}

export async function commitMovement(env, state, fetchFn) {
  let writeAttempted = false, primarySaved = false;
  try {
    if (!state.row?.sku || !normalizeLocation(state.to) || normalizeLocation(state.to) === normalizeLocation(state.row.lokasi_bulky) || !Number.isFinite(state.qty) || state.qty <= 0 || !state.pic) throw new GoogleAccessError('MOVEMENT_INVALID_DRAFT', 'Data movement belum valid. Periksa From, To dan qty.');
    const access = await googleToken(env, fetchFn);
    const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };
    const base = id => `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
    const read = (id, range, label = 'SHEET_ID_2026') => readSheetValues({ id, range, label, headers, fetchFn });
    const stock = await readKartuStock(env, read);
    const parsed = parseKartuStockHeader(stock);
    if (parsed.missing.length) return `${stockHeaderFailure(parsed)}\nMovement tidak disimpan.`;
    const indices = parsed.indices;
    const matching = stock.slice(parsed.headerIndex + 1).filter(row => normalizeSku(row[indices[1]]) === normalizeSku(state.row.sku) && normalizeLocation(row[indices[0]]) === normalizeLocation(state.row.lokasi_bulky));
    if (matching.length !== 1) return 'Barang/lokasi asal tidak ditemukan atau memiliki baris ganda. Movement tidak disimpan. Periksa lokasi asal di WMS.';
    const available = normalizeNumber(matching[0][indices[3]]).value;
    if (!Number.isFinite(available) || available < state.qty) return 'Stok asal tidak mencukupi. Movement tidak disimpan. Balas ubah untuk mengganti qty/lokasi.';
    const identity = stockIdentity(matching, indices, { ...state, direction: 'out', location: state.row.lokasi_bulky });
    if (!identity.matches && !identity.name) return 'Nama barang pada lokasi asal belum dapat dipastikan. Movement tidak disimpan.';
    if (available !== Number(state.row.stok_akhir) || !identity.matches) return { reviewRequired: true, row: { ...state.row, stok_akhir: available, nama_barang: identity.name || state.row.nama_barang }, reply: 'Data barang/stok asal diperbarui dari Kartu Stock. Periksa ringkasan terbaru; belum ada transaksi ditulis.' };
    const slot = await findTransactionSlot({ id: env.SHEET_ID_2026, sheet: 'Barang Masuk', label: 'SHEET_ID_2026', headers, fetchFn });
    const expected = ['TANGGAL','FROM','TO','SKU','NAMABARANG','QTY','STATUS','PIC','KETERANGAN'];
    if (expected.some((name, index) => String(slot.header[index] || '').toUpperCase().replace(/\s/g, '') !== name)) return 'Kolom Barang Masuk tidak sesuai WMS. Movement tidak disimpan.';
    // Preflight history before any transaction write; match the app's header aliases.
    const history = await readSheetPreview({ id: env.SHEET_ID_INVENTORY, sheet: 'Movement', label: 'SHEET_ID_INVENTORY', headers, fetchFn });
    const headerIndex = history.findIndex(row => {
      const h = row.map(value => String(value).toUpperCase().replace(/[\s_]/g, ''));
      return h[0] === 'TANGGAL' && h[1] === 'FROM' && h[2] === 'TO' && h[3] === 'SKU' && ['NAMA','NAMABARANG'].includes(h[4]) && ['AWAL','STOKLOKASIAWAL','STOKDILOKASIAWAL'].includes(h[5]) && ['AKTUAL','STOKAKTUAL'].includes(h[6]);
    });
    if (headerIndex < 0) return 'Kolom riwayat Movement tidak sesuai WMS. Movement tidak disimpan.';
    const current = await readTransactionRow({ id: env.SHEET_ID_2026, sheet: 'Barang Masuk', rowNumber: slot.rowNumber, label: 'SHEET_ID_2026', headers, fetchFn });
    if (normalizeText(current[0]?.[0]) || normalizeText(current[0]?.[3])) return 'Baris tujuan sudah diisi proses lain. Movement belum disimpan.';
    const { date, sheetDate } = movementDates(new Date(), env.BUSINESS_TIME_ZONE || 'Asia/Jakarta');
    const from = state.row.lokasi_bulky, to = state.to;
    const range = `'Barang Masuk'!A${slot.rowNumber}:I${slot.rowNumber}`;
    writeAttempted = true;
    const primary = await fetchFn(`${base(env.SHEET_ID_2026)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { method: 'PUT', headers, body: JSON.stringify({ values: [[sheetDate, from, to, state.row.sku, state.row.nama_barang, state.qty, 'Movement', state.pic, 'INTERNAL STOCK TRANSFER']] }), signal: AbortSignal.timeout(15000) });
    if (!primary.ok) throw await googleResponseError(primary, true);
    primarySaved = true;
    const historyRange = `'Movement'!A${headerIndex + 2}:G`;
    const secondary = await fetchFn(`${base(env.SHEET_ID_INVENTORY)}/values/${encodeURIComponent(historyRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', headers, body: JSON.stringify({ values: [[date, from, to, state.row.sku, state.row.nama_barang, available, state.qty]] }), signal: AbortSignal.timeout(15000) });
    if (!secondary.ok) throw await googleResponseError(secondary, true, 'SHEET_ID_INVENTORY');
    return { saved: true, rowNumber: slot.rowNumber, from, to, date, reply: `✅ *Movement tersimpan*\nBarang: ${displayText(state.row.nama_barang)}\nSKU: ${displayText(state.row.sku)}\nFrom: ${displayText(from)}\nTo: ${displayText(to)}\nQty: ${state.qty}\nStok awal: ${available}\nSisa stok asal: ${available - state.qty}\nPIC: ${displayText(state.pic)}\nTanggal: ${date}` };
  } catch (error) {
    if (primarySaved) return { partial: true, reply: 'Barang Masuk berstatus Movement sudah tersimpan; riwayat Movement belum terkonfirmasi. Jangan mengulang. Minta admin memeriksa kedua tab.' };
    if (error instanceof GoogleAccessError) { error.writeAttempted ||= writeAttempted; throw error; }
    throw new GoogleAccessError('MOVEMENT_GOOGLE_FAILED', writeAttempted ? 'Penulisan movement belum terkonfirmasi.' : 'Pembacaan data movement gagal. Coba ulang nanti.', writeAttempted);
  }
}
