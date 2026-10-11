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
  const targets = [[env.SHEET_ID_2026, 'SHEET_ID_2026', ['Kartu Stock', 'Barang Masuk', 'Barang KeIuar']], [env.SHEET_ID_INVENTORY, 'SHEET_ID_INVENTORY', ['Movement']]];
  for (const [id, label, required] of targets) {
    if (!id) { lines.push(`${label}: belum diisi (diperlukan untuk movement).`); continue; }
    try {
      const response = await fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw await googleResponseError(response, false, label);
      const payload = await response.json();
      const titles = (payload.sheets || []).map(sheet => sheet.properties?.title);
      const missing = required.filter(title => !titles.includes(title));
      lines.push(`${label}: bisa dibaca.`);
      lines.push(missing.length ? `Tab belum ditemukan: ${missing.join(', ')}.` : 'Tab wajib: tersedia.');
    } catch (error) { lines.push(`${label}: ${error instanceof GoogleAccessError ? error.userMessage + '\nKode: ' + error.code : 'Pemeriksaan koneksi belum berhasil.'}`); }
  }
  lines.push('', 'Tidak ada transaksi ditulis. Izin Editor/proteksi tab belum diuji lewat penulisan.');
  return lines.join('\n');
}
