import { readKartuStock } from './kartu-stok-source.js';
import { googleResponseError } from './google-errors.js';
import { displayText } from './menu.js';
import { googleToken } from './sheet-edit.js';
import { normalizeLocation, normalizeSku, normalizeNumber } from './sheet-normalization.js';

export function movementDates(now = new Date(), timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = name => parts.find(part => part.type === name).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, sheetDate: `${Number(get('month'))}/${Number(get('day'))}/${get('year')}` };
}

export async function commitMovement(env, state, fetchFn) {
  const access = await googleToken(env, fetchFn);
  const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };
  const base = id => `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
  const read = async (id, range, label = 'SHEET_ID_2026') => {
    const response = await fetchFn(`${base(id)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw await googleResponseError(response, false, label);
    return (await response.json()).values || [];
  };
  // Re-read the authoritative stock sheet, rather than trusting the sync snapshot.
  const stock = await readKartuStock(env, read);
  const normalizedHeaders = (stock[0] || []).map(value => String(value).toUpperCase().replace(/\s/g, ''));
  const indices = ['LOKASIBULKY', 'SKU', 'NAMABARANG', 'STOKAKHIR'].map(name => normalizedHeaders.indexOf(name));
  if (indices.some(index => index < 0)) return 'Kolom Kartu Stok tidak sesuai WMS. Movement tidak disimpan.';
  const matching = stock.slice(1).filter(row => normalizeSku(row[indices[1]]) === normalizeSku(state.row.sku) && normalizeLocation(row[indices[0]]) === normalizeLocation(state.row.lokasi_bulky));
  if (matching.length !== 1) return 'Barang/lokasi asal berubah atau memiliki baris ganda. Movement tidak disimpan. Cari ulang setelah sinkronisasi.';
  const available = normalizeNumber(matching[0][indices[3]]).value;
  if (!Number.isFinite(available) || available < state.qty || available !== Number(state.row.stok_akhir)) return 'Stok asal sudah berubah atau tidak mencukupi. Movement tidak disimpan. Sinkronkan WMS lalu mulai ulang.';
  const inbound = await read(env.SHEET_ID_2026, "'Barang Masuk'!A1:I1");
  const expected = ['TANGGAL', 'FROM', 'TO', 'SKU', 'NAMABARANG', 'QTY', 'STATUS', 'PIC', 'KETERANGAN'];
  if (expected.some((name, i) => String(inbound[0]?.[i] || '').toUpperCase().replace(/\s/g, '') !== name)) return 'Kolom Barang Masuk tidak sesuai WMS. Movement tidak disimpan.';
  // Ensure the second destination exists before the first mutation.
  const history = await read(env.SHEET_ID_INVENTORY, "'Movement'!A1:G1");
  const historyHeaders = (history[0] || []).map(value => String(value).toUpperCase().replace(/[\s_]/g, ''));
  if (historyHeaders[0] !== 'TANGGAL' || historyHeaders[1] !== 'FROM' || historyHeaders[2] !== 'TO' || historyHeaders[3] !== 'SKU' || !['NAMABARANG', 'NAMA'].includes(historyHeaders[4]) || !['STOKLOKASIAWAL', 'STOKDILOKASIAWAL', 'AWAL'].includes(historyHeaders[5]) || !['STOKAKTUAL', 'AKTUAL'].includes(historyHeaders[6])) return 'Kolom Movement tidak sesuai WMS. Movement tidak disimpan.';
  const { date, sheetDate } = movementDates(new Date(), env.BUSINESS_TIME_ZONE || 'Asia/Jakarta');
  const append = async (id, range, values) => {
    const response = await fetchFn(`${base(id)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', headers, body: JSON.stringify({ values: [values] }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Movement write failed or uncertain');
  };
  // Same business entries as /api/movement/in. Stock formulas remain managed by WMS.
  await append(env.SHEET_ID_2026, "'Barang Masuk'!A:I", [sheetDate, state.row.lokasi_bulky, state.to, state.row.sku, state.row.nama_barang, state.qty, 'Movement', state.pic, `INTERNAL STOCK TRANSFER | WA:${state.nonce}`]);
  try { await append(env.SHEET_ID_INVENTORY, "'Movement'!A:G", [date, state.row.lokasi_bulky, state.to, state.row.sku, state.row.nama_barang, available, state.qty]); }
  catch { return `Barang Masuk tersimpan; riwayat Movement belum terkonfirmasi. Jangan mengulang movement. Minta admin memeriksa kedua sheet.\nReferensi: ${state.nonce}`; }
  return `✅ *Movement tersimpan*\n${displayText(state.row.sku)}\n${displayText(state.row.lokasi_bulky)} → ${displayText(state.to)}\nJumlah: ${state.qty}\nPIC: ${displayText(state.pic)}\nTanggal: ${date}\n\nSinkronkan WMS untuk memperbarui Kartu Stok dan pencarian Supabase.\nReferensi: ${state.nonce}`;
}
