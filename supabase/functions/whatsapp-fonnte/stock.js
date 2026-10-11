import { resolvePic } from '../../../assets/js/pic-config.js';
import { writeStockAudit } from './stock-audit.js';
import { formatGoogleFailure, GoogleAccessError } from './google-errors.js';
import { hasGoogleCredentials } from './sheet-edit.js';
import { loadSearch, saveSearch } from './sessions.js';
import { displayText } from './menu.js';
import { searchStockItems, stockLocations } from './stock-search.js';
import { normalizeLocation, normalizeText } from './sheet-normalization.js';
import { requireStockProfile, ProfileError } from './profiles.js';
import { commitStock } from './sheet-stock.js';

const headers = config => ({ apikey: config.key, Authorization: `Bearer ${config.key}` });
const label = state => state.direction === 'in' ? 'Inbound' : 'Outbount';
const review = state => `📦 *Tinjau ${label(state)}*\nBarang: ${displayText(state.row.nama_barang)}\nSKU: ${displayText(state.row.sku)}${state.direction === 'in' ? `\nFrom: ${displayText(state.from)}\nTo: ${displayText(state.to)}` : `\nFrom: ${displayText(state.location)}`}\nQty: ${state.qty}\nPIC: ${displayText(state.pic)}\n\nTanggal dan status diisi otomatis saat disimpan.\nBalas y untuk menyimpan, ubah untuk mulai ulang, atau batal.`;
const prompt = state => `*${label(state)}*\nKirim SKU atau nama barang. Bisa digabung lokasi.\nContoh: merlyn a20-1\n\nKetik batal untuk keluar.`;

const defaultFrom = 'IWT E-COM';
const defaultTo = 'MASIH DI INBOUND';
const fromPrompt = state => `*From • Inbound*\nBarang: ${displayText(state.row.nama_barang)}\nSKU: ${displayText(state.row.sku)}\n\nGunakan From: *${defaultFrom}*?\nBalas y untuk memakai default, atau kirim nilai pengganti.`;
const toPrompt = state => `*To • Inbound*\nFrom: ${displayText(state.from)}\n\nGunakan To: *${defaultTo}*?\nBalas y untuk memakai default, atau kirim nilai pengganti.`;

const locationPrompt = state => {
  const page = state.locationPage || 1;
  const rows = state.locations.slice((page - 1) * 10, page * 10);
  return `*Outbount • Pilih Lokasi Asal*\nBarang: ${displayText(state.row.nama_barang)}\nSKU: ${displayText(state.row.sku)}\n\n` + rows.map((row, index) => `*${index + 1}. ${displayText(row.location)}* • Stok: ${row.qty}`).join('\n')
    + `\n\nHalaman ${page} • ${rows.length} lokasi\nBalas nomor lokasi atau ketik lokasi.`
    + (page * 10 < state.locations.length ? '\nBerikutnya: balas lanjut.' : '')
    + (page > 1 ? '\nSebelumnya: balas sebelumnya.' : '');
};

export async function handleStock(message, sender, env, config, fetchFn) {
  const input = message.trim(), lower = input.toLowerCase();
  const alias = /^(inbound|outbount|outbound)(?:\s+(.+))?$/i.exec(input);
  const start = alias ? [alias[0], alias[1].toLowerCase() === 'inbound' ? 'in' : 'out', alias[2]]
    : /^(?:stock|stok)[\s-]*(in|out)(?:\s+(.+))?$/i.exec(input);
  if (!start && /^(help|bantuan|halo|hai|mulai|start)$/.test(lower)) return undefined;
  let state = await loadSearch(config, sender, fetchFn);
  const active = state?.kind === 'stock';
  if (!start && !active) return undefined;
  // Keep an uncertain write protected, even if the sender starts another command.
  if (state?.phase === 'saving') return 'Transaksi sedang diproses atau belum terkonfirmasi. Periksa WMS sebelum mengulang.';
  if (!start && state.phase === 'done') {
    return ['y', 'simpan', 'ulang'].includes(lower) ? 'Stock in/out sebelumnya sudah diproses. Periksa WMS sebelum membuat transaksi baru.' : undefined;
  }
  if (active && (lower === 'batal' || lower === 'menu')) {
    await saveSearch(config, sender, {}, fetchFn);
    return lower === 'menu' ? undefined : 'Stock in/out dibatalkan. Tidak ada transaksi disimpan.';
  }
  let profile;
  try { profile = await requireStockProfile(config, sender, fetchFn); }
  catch (error) { if (error instanceof ProfileError) return error.message; throw error; }
  if (!hasGoogleCredentials(env) || !env.SHEET_ID_2026) return 'Stock in/out belum dikonfigurasi. Admin perlu mengisi kredensial Google OAuth atau Service Account dan SHEET_ID_2026 di Supabase Secrets.';
  if (active && !start && state.profile.id !== profile.id) return 'Profil nomor WhatsApp sudah berubah. Batalkan draft lalu mulai stock in/out baru.';
  if (start || lower === 'ubah') {
    state = { kind: 'stock', direction: start ? start[1].toLowerCase() : state.direction, phase: 'query', page: 1, nonce: crypto.randomUUID(), pic: resolvePic(profile.role), profile: { id: profile.id, full_name: normalizeText(profile.full_name), email: profile.email, role: profile.role } };
    await saveSearch(config, sender, state, fetchFn);
    if (!start?.[2]) return prompt(state);
  }
  let retrying = false;
  if (state.phase === 'retry') {
    if (lower !== 'ulang') return 'Transaksi sebelumnya belum tersimpan. Balas ulang untuk mencoba lagi dengan data yang sama, ubah untuk mengisi ulang, atau batal.';
    const next = { ...state, phase: 'confirm' };
    const response = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?sender=eq.${encodeURIComponent(sender)}&search->>nonce=eq.${state.nonce}&search->>phase=eq.retry&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, {
      method: 'PATCH', headers: { ...headers(config), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ search: next }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !(await response.json()).length) return 'Percobaan ulang sudah diproses atau kedaluwarsa. Periksa WMS.';
    state = next; retrying = true;
  }
  if (state.phase === 'query' || state.phase === 'select') {
    if (state.phase === 'select' && /^\d+$/.test(input)) {
      const row = state.rows[Number(input) - 1];
      if (!row) return 'Nomor barang tidak tersedia. Pilih nomor hasil atau kirim pencarian baru.';
      state = { ...state, row, rows: undefined, phase: state.direction === 'in' ? 'from_default' : 'select_location' };
      if (state.direction === 'in') {
        await saveSearch(config, sender, state, fetchFn);
        return fromPrompt(state);
      }
      state.locations = await stockLocations(config, row.sku, fetchFn); state.locationPage = 1;
      if (!state.locations.length) {
        state.phase = 'query'; await saveSearch(config, sender, state, fetchFn);
        return 'Tidak ada lokasi dengan stok tersedia yang dapat dipilih. Kirim pencarian lain.';
      }
      await saveSearch(config, sender, state, fetchFn);
      return locationPrompt(state);
    }
    if (state.phase === 'select' && /^(lanjut|berikutnya|sebelumnya)$/.test(lower)) {
      if (lower === 'sebelumnya' && state.page === 1) return 'Sudah di halaman pertama.';
      if (lower !== 'sebelumnya' && !state.hasMore) return 'Sudah di halaman terakhir.';
      state.page += lower === 'sebelumnya' ? -1 : 1;
    } else {
      state.query = start?.[2] || input; state.page = 1;
      if (state.query.length < 2 || state.query.length > 200) return 'Pencarian harus 2–200 karakter. Kirim SKU atau nama barang.';
    }
    const result = await searchStockItems(config, state, fetchFn);
    const rows = result.rows;
    state.rows = rows; state.hasMore = result.hasMore; state.phase = rows.length ? 'select' : 'query';
    await saveSearch(config, sender, state, fetchFn);
    if (!rows.length) return `Barang${state.direction === 'out' ? ' dengan stok tersedia' : ''} tidak ditemukan. Kirim pencarian lain.`;
    return `*${label(state)} • Pilih barang*\n\n` + state.rows.map((row, i) => `*${i + 1}. ${displayText(row.nama_barang)}*\nSKU: ${displayText(row.sku)}`).join('\n\n') + `\n\nHalaman ${state.page}. Balas nomor barang.` + (state.hasMore ? '\nBalas lanjut untuk hasil lainnya.' : '') + (state.page > 1 ? '\nBalas sebelumnya untuk kembali.' : '');
  }
  if (state.phase === 'from' || state.phase === 'from_default') {
    const from = normalizeLocation(lower === 'y' ? defaultFrom : input);
    if (!from || from.length > 100 || /[\r\n\u0000-\u001f]/.test(input)) return 'Kirim From yang valid, maksimal 100 karakter.';
    state.from = from; state.phase = 'to_default'; await saveSearch(config, sender, state, fetchFn);
    return toPrompt(state);
  }
  let selectedLocation;
  if (state.phase === 'select_location') {
    if (/^(lanjut|berikutnya|sebelumnya)$/.test(lower)) {
      const page = state.locationPage || 1;
      if (lower === 'sebelumnya' && page === 1) return 'Sudah di halaman pertama.\n\n' + locationPrompt(state);
      if (lower !== 'sebelumnya' && page * 10 >= state.locations.length) return 'Sudah di halaman terakhir.\n\n' + locationPrompt(state);
      state.locationPage = page + (lower === 'sebelumnya' ? -1 : 1);
      await saveSearch(config, sender, state, fetchFn); return locationPrompt(state);
    }
    if (/^\d+$/.test(input)) {
      const index = Number(input) - 1;
      const row = index >= 0 && index < 10 ? state.locations[((state.locationPage || 1) - 1) * 10 + index] : undefined;
      if (!row) return 'Nomor lokasi tidak tersedia.\n\n' + locationPrompt(state);
      selectedLocation = row.location;
    }
    state.phase = 'location';
  }
  if (state.phase === 'location' || state.phase === 'to' || state.phase === 'to_default') {
    const location = normalizeLocation(state.direction === 'in' ? (lower === 'y' ? defaultTo : input) : selectedLocation || (lower === 'sama' ? state.row.lokasi_bulky : input));
    if (!location || location.length > 100 || /[\r\n\u0000-\u001f]/.test(input)) return 'Kirim lokasi yang valid, maksimal 100 karakter.';
    // Validate the location belongs to this SKU; stock in can use a new location.
    if (state.direction === 'out') {
      const response = await fetchFn(`${config.url}/rest/v1/inventory_kartu_stok?select=stok_akhir&sku=eq.${encodeURIComponent(state.row.sku)}&lokasi_bulky=eq.${encodeURIComponent(location)}&limit=2`, { headers: headers(config), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Stock location read failed');
      const rows = await response.json();
      if (rows.length !== 1 || !Number.isFinite(Number(rows[0].stok_akhir)) || Number(rows[0].stok_akhir) <= 0) return 'SKU tidak memiliki satu baris stok positif di lokasi tersebut. Kirim lokasi asal lain.';
      state.available = Number(rows[0].stok_akhir);
    }
    state.location = location; state.locations = undefined; if (state.direction === 'in') state.to = location; state.phase = 'quantity'; await saveSearch(config, sender, state, fetchFn);
    return `*Qty ${label(state)}*\nKirim jumlah lebih dari 0${state.direction === 'out' ? `, maksimal ${state.available}` : ''}.`;
  }
  if (state.phase === 'quantity') {
    const qty = Number(input);
    if (!/^\d+(?:\.\d+)?$/.test(input) || !Number.isFinite(qty) || qty <= 0 || (state.direction === 'out' && qty > state.available)) return `Qty harus lebih dari 0${state.direction === 'out' ? ` dan maksimal ${state.available}` : ''}. Kirim jumlah yang benar.`;
    state.qty = qty; state.profile = { id: profile.id, full_name: normalizeText(profile.full_name), email: profile.email, role: profile.role }; state.pic = resolvePic(profile.role); state.phase = 'confirm';
    await saveSearch(config, sender, state, fetchFn); return review(state);
  }
  if (lower !== 'y' && !retrying) return review(state);
  if (state.pic !== resolvePic(profile.role)) {
    state.pic = resolvePic(profile.role); state.profile = { id: profile.id, full_name: normalizeText(profile.full_name), email: profile.email, role: profile.role };
    await saveSearch(config, sender, state, fetchFn);
    return 'PIC konfigurasi berubah mengikuti role. Periksa ringkasan terbaru sebelum menyimpan.\n\n' + review(state);
  }
  const claim = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?sender=eq.${encodeURIComponent(sender)}&search->>nonce=eq.${state.nonce}&search->>phase=eq.confirm&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'PATCH', headers: { ...headers(config), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ search: { ...state, phase: 'saving' } }), signal: AbortSignal.timeout(10000) });
  if (!claim.ok) return 'Penyimpanan belum dapat dimulai. Coba lagi.';
  if (!(await claim.json()).length) return 'Konfirmasi sudah diproses atau kedaluwarsa. Periksa WMS.';
  let reply, retryable = false;
  try {
    const result = await commitStock(env, state, fetchFn);
    reply = typeof result === 'string' ? result : result.reply;
    retryable = typeof result === 'string';
    if (result.saved) {
      try { await writeStockAudit(config, profile, state, result, fetchFn); }
      catch { reply += '\nHistory WMS belum tercatat. Transaksi sudah tersimpan; jangan ulang transaksi.'; }
    }
  }
  catch (error) {
    console.error('[WHATSAPP_STOCK_GOOGLE_FAILED]', JSON.stringify({ reference: state.nonce, code: error.code || 'UNKNOWN', writeAttempted: error.writeAttempted ?? true }));
    retryable = error instanceof GoogleAccessError && !error.writeAttempted;
    reply = formatGoogleFailure(error, undefined, `Barang ${state.direction === 'in' ? 'Masuk' : 'Keluar'}`);
  }
  if (retryable) reply += '\n\nBalas ulang untuk mencoba lagi dengan data input yang sama.';
  await saveSearch(config, sender, retryable ? { ...state, phase: 'retry' } : { kind: 'stock', phase: 'done', nonce: state.nonce, direction: state.direction }, fetchFn);
  return reply;
}
