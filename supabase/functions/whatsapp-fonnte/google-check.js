import { parseKartuStockHeader, stockHeaderFailure } from './kartu-stok-header.js';
import { kartuStokCandidates } from './kartu-stok-source.js';
import { displayText } from './menu.js';
import { googleToken, hasGoogleCredentials } from './sheet-edit.js';
import { GoogleAccessError, googleResponseError } from './google-errors.js';

export async function handleGoogleCheck(message, env, fetchFn) {
  if (!/^(cek\s*google|status google)$/i.test(message.trim())) return undefined;
  const oauth = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN'].some(key => Boolean(env[key]));
  const mode = oauth ? 'OAuth Gmail' : 'Service Account';
  if (!hasGoogleCredentials(env)) return `*Cek Google • ${mode}*\nKredensial belum lengkap. ${oauth ? 'Isi GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, dan GOOGLE_OAUTH_REFRESH_TOKEN.' : 'Isi kredensial OAuth Gmail atau GOOGLE_CLIENT_EMAIL dan GOOGLE_PRIVATE_KEY.'}\nTidak ada transaksi ditulis.`;
  if (!env.SHEET_ID_2026) return '*Cek Google*\nSHEET_ID_2026 belum diisi. Gunakan ID spreadsheet, bukan URL lengkap.\nTidak ada transaksi ditulis.';
  let access;
  try { access = await googleToken(env, fetchFn); }
  catch (error) { return `*Cek Google • ${mode}*\n${error instanceof GoogleAccessError ? error.userMessage + '\nKode: ' + error.code : 'Autentikasi Google gagal. Periksa kredensial di Supabase Secrets.'}\nTidak ada transaksi ditulis.`; }
  const lines = [`*Cek Google • ${mode}*`, 'Autentikasi: berhasil.'];
  if (oauth) {
    try {
      const identity = await fetchFn('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10000) });
      const user = await identity.json();
      lines.push(identity.ok && typeof user.email === 'string' ? `Akun OAuth: ${displayText(user.email)}.` : 'Akun OAuth: email belum terverifikasi; otorisasi dengan scope userinfo.email untuk memeriksanya.');
    } catch { lines.push('Akun OAuth: email belum dapat diperiksa.'); }
  } else lines.push(`Akun Google: ${displayText(env.GOOGLE_CLIENT_EMAIL)}.`);
  const targets = [[env.SHEET_ID_2026, 'SHEET_ID_2026', ['Barang Masuk', 'Barang KeIuar']], [env.SHEET_ID_INVENTORY, 'SHEET_ID_INVENTORY', ['Movement']]];
  if (env.SHEET_ID_KARTU_STOK) targets.push([env.SHEET_ID_KARTU_STOK, 'SHEET_ID_KARTU_STOK', ['Kartu Stock']]);
  const checked = new Map();
  for (const [id, label, required] of targets) {
    if (!id) { lines.push(`${label}: belum diisi (diperlukan untuk movement).`); continue; }
    try {
      let titles = checked.get(id);
      if (!titles) {
        const response = await fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw await googleResponseError(response, false, label);
        const payload = await response.json();
        titles = (payload.sheets || []).map(sheet => sheet.properties?.title);
        checked.set(id, titles);
      }
      const missing = required.filter(title => !titles.includes(title));
      lines.push(`${label}: bisa dibaca.`);
      lines.push(missing.length ? `Tab belum ditemukan: ${missing.join(', ')}.` : 'Tab wajib: tersedia.');
    } catch (error) { lines.push(`${label}: ${error instanceof GoogleAccessError ? error.userMessage + '\nKode: ' + error.code : 'Pemeriksaan koneksi belum berhasil.'}`); }
  }
  let stockSource, stockId, unchecked = false;
  for (const candidate of kartuStokCandidates(env)) {
    const titles = checked.get(candidate.id);
    if (!titles) { unchecked = true; break; }
    if (titles.includes('Kartu Stock')) { stockSource = candidate.label; stockId = candidate.id; break; }
  }
  lines.push(stockSource ? `Kartu Stock: tersedia di ${stockSource}.` : unchecked ? 'Kartu Stock: sumber belum dapat diperiksa; perbaiki akses spreadsheet di atas.' : 'Kartu Stock: belum ditemukan. Isi SHEET_ID_KARTU_STOK dengan ID spreadsheet sumber stok.');
  if (stockId) {
    try {
      const range = "'Kartu Stock'!A1:AZ50";
      const response = await fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(stockId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw await googleResponseError(response, false, stockSource);
      const values = (await response.json()).values || [];
      const parsed = parseKartuStockHeader(values);
      lines.push(parsed.missing.length ? stockHeaderFailure(parsed) : `Header Kartu Stock: sesuai, baris ${parsed.headerIndex + 1}.`);
      if (parsed.headerIndex >= 0) lines.push(`Kolom terbaca: ${values[parsed.headerIndex].map(displayText).filter(Boolean).join(' | ')}.`);
    } catch (error) { lines.push(`Header Kartu Stock: ${error instanceof GoogleAccessError ? error.userMessage : 'belum dapat diperiksa.'}`); }
  }
  lines.push('', 'Tidak ada transaksi ditulis. Izin Editor/proteksi tab belum diuji lewat penulisan.');
  return lines.join('\n');
}
