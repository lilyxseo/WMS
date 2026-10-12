import { resolvePic } from '../../../assets/js/pic-config.js';
import { hasGoogleCredentials } from './sheet-edit.js';
import { loadSearch, saveSearch } from './sessions.js';
import { requireStockProfile, ProfileError } from './profiles.js';
import { displayText } from './menu.js';
import { searchStockItems, stockLocations } from './stock-search.js';
import { normalizeLocation, normalizeText } from './sheet-normalization.js';
import { GoogleAccessError, formatGoogleFailure } from './google-errors.js';
import { commitMovement } from './sheet-movement.js';
import { writeMovementAudit } from './stock-audit.js';

const headers = config => ({ apikey: config.key, Authorization: `Bearer ${config.key}` });
const profileData = profile => ({ id: profile.id, full_name: normalizeText(profile.full_name), email: profile.email, role: profile.role });
const prompt = '*Movement*\nKirim SKU atau nama barang. Bisa digabung lokasi.\nContoh: movement merlyn a20-1\n\nKetik batal untuk keluar.';
const review = state => `📦 *Tinjau Movement*\nBarang: ${displayText(state.row.nama_barang)}\nSKU: ${displayText(state.row.sku)}\nFrom: ${displayText(state.row.lokasi_bulky)}\nTo: ${displayText(state.to)}\nQty: ${state.qty}\nStok awal: ${state.row.stok_akhir}\nSisa stok asal: ${Number(state.row.stok_akhir) - state.qty}\nPIC: ${displayText(state.pic)}\n\nBalas y untuk menyimpan, ubah untuk mulai ulang, atau batal.`;
const qtyPrompt = state => `*Qty Movement*\nStok asal: ${state.row.stok_akhir}\nBalas y untuk memindahkan seluruh stok (${state.row.stok_akhir}), atau kirim qty lebih dari 0.`;
const locationPattern = location => `${(location.match(/[A-Z]+/g) || []).join('')}|${(location.match(/\d/g) || []).length}`;
function locationPrompt(state) {
  const source = state.phase === 'source', page = state.locationPage || 1;
  const rows = state.locations.slice((page - 1) * 10, page * 10);
  return `*Movement • ${source ? 'Pilih From' : 'Pilih To'}*\nSKU: ${displayText(state.row.sku)}${source ? '' : `\nFrom: ${displayText(state.row.lokasi_bulky)} • Stok: ${state.row.stok_akhir}`}\n\n`
    + (rows.length ? rows.map((row, index) => `*${index + 1}. ${displayText(row.location)}* • Stok: ${row.qty}`).join('\n') + `\n\nHalaman ${page} • ${rows.length} lokasi\n` : '')
    + (source ? 'Balas nomor lokasi atau ketik lokasi asal.' : state.locations.length ? `Balas y untuk saran To: ${displayText(state.locations[0].location)}, nomor lokasi, atau ketik tujuan baru.` : 'Ketik lokasi tujuan baru.')
    + (page * 10 < state.locations.length ? '\nBerikutnya: balas lanjut.' : '') + (page > 1 ? '\nSebelumnya: balas sebelumnya.' : '');
}

export async function handleMovement(message, sender, env, config, fetchFn) {
  const input = message.trim(), lower = input.toLowerCase(), start = /^movement(?:\s+(.+))?$/i.exec(input);
  if (!start && /^(help|bantuan|halo|hai|mulai|start)$/.test(lower)) return undefined;
  let state = await loadSearch(config, sender, fetchFn);
  if (!start && state?.kind !== 'movement') return undefined;
  if (state?.phase === 'saving') return 'Movement sedang diproses atau belum terkonfirmasi. Periksa WMS sebelum mengulang.';
  if (!start && state.phase === 'done') return ['y','ulang','simpan'].includes(lower) ? 'Movement sebelumnya sudah diproses. Periksa WMS sebelum membuat movement baru.' : undefined;
  if (!start && ['batal','menu'].includes(lower)) {
    await saveSearch(config, sender, {}, fetchFn);
    return lower === 'menu' ? undefined : 'Movement dibatalkan. Tidak ada data disimpan.';
  }
  let profile;
  try { profile = await requireStockProfile(config, sender, fetchFn); }
  catch (error) { if (error instanceof ProfileError) return error.message; throw error; }
  if (!hasGoogleCredentials(env) || !env.SHEET_ID_2026 || !env.SHEET_ID_INVENTORY) return 'Movement belum dikonfigurasi. Isi kredensial Google, SHEET_ID_2026 dan SHEET_ID_INVENTORY.';
  if (!start && state.profile?.id !== profile.id) return 'Profil nomor berubah. Batalkan draft lalu mulai movement baru.';
  if (start || lower === 'ubah') {
    state = { kind: 'movement', phase: 'query', nonce: crypto.randomUUID(), page: 1, profile: profileData(profile), pic: resolvePic(profile.role) };
    await saveSearch(config, sender, state, fetchFn);
    if (!start?.[1]) return prompt;
  }
  let retrying = false;
  if (state.phase === 'retry') {
    if (lower !== 'ulang') return 'Movement belum tersimpan. Balas ulang untuk mencoba lagi dengan data yang sama, ubah, atau batal.';
    const next = { ...state, phase: 'confirm' };
    const response = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?sender=eq.${encodeURIComponent(sender)}&search->>nonce=eq.${state.nonce}&search->>phase=eq.retry&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'PATCH', headers: { ...headers(config), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ search: next }), signal: AbortSignal.timeout(10000) });
    if (!response.ok || !(await response.json()).length) return 'Percobaan ulang sudah diproses atau kedaluwarsa. Periksa WMS.';
    state = next; retrying = true;
  }
  if (state.phase === 'query' || state.phase === 'select') {
    if (state.phase === 'select' && /^\d+$/.test(input)) {
      const row = state.rows[Number(input) - 1];
      if (!row) return 'Nomor barang tidak tersedia. Pilih nomor hasil atau kirim pencarian baru.';
      const locations = await stockLocations(config, row.sku, fetchFn);
      if (!locations.length) return 'Tidak ada lokasi asal dengan stok positif yang dapat dipilih. Kirim pencarian lain.';
      state = { ...state, row, rows: undefined, locations, locationPage: 1, phase: 'source' };
      await saveSearch(config, sender, state, fetchFn); return locationPrompt(state);
    }
    if (state.phase === 'select' && /^(lanjut|berikutnya|sebelumnya)$/.test(lower)) {
      if (lower === 'sebelumnya' && state.page === 1) return 'Sudah di halaman pertama.';
      if (lower !== 'sebelumnya' && !state.hasMore) return 'Sudah di halaman terakhir.';
      state.page += lower === 'sebelumnya' ? -1 : 1;
    } else {
      state.query = start?.[1] || input; state.page = 1;
      if (state.query.length < 2 || state.query.length > 200) return 'Pencarian harus 2–200 karakter. ' + prompt;
    }
    const result = await searchStockItems(config, { ...state, direction: 'out' }, fetchFn);
    state.rows = result.rows; state.hasMore = result.hasMore; state.phase = result.rows.length ? 'select' : 'query';
    await saveSearch(config, sender, state, fetchFn);
    if (!result.rows.length) return 'Barang dengan stok tersedia tidak ditemukan. Kirim pencarian lain.';
    return '*Movement • Pilih barang*\n\n' + state.rows.map((row, index) => `*${index + 1}. ${displayText(row.nama_barang)}*\nSKU: ${displayText(row.sku)}`).join('\n\n') + `\n\nHalaman ${state.page} • ${state.rows.length} SKU\nBalas nomor barang.` + (state.hasMore ? '\nBerikutnya: balas lanjut.' : '') + (state.page > 1 ? '\nSebelumnya: balas sebelumnya.' : '');
  }
  if (state.phase === 'source' || state.phase === 'destination') {
    if (/^(lanjut|berikutnya|sebelumnya)$/.test(lower)) {
      const page = state.locationPage || 1;
      if (lower === 'sebelumnya' && page === 1) return 'Sudah di halaman pertama.\n\n' + locationPrompt(state);
      if (lower !== 'sebelumnya' && page * 10 >= state.locations.length) return 'Sudah di halaman terakhir.\n\n' + locationPrompt(state);
      state.locationPage = page + (lower === 'sebelumnya' ? -1 : 1);
      await saveSearch(config, sender, state, fetchFn); return locationPrompt(state);
    }
    let location = input;
    if (state.phase === 'destination' && lower === 'y' && state.locations.length) location = state.locations[0].location;
    else if (/^\d+$/.test(input)) {
      const index = Number(input) - 1, row = index >= 0 && index < 10 ? state.locations[((state.locationPage || 1) - 1) * 10 + index] : undefined;
      if (!row) return 'Nomor lokasi tidak tersedia.\n\n' + locationPrompt(state);
      location = row.location;
    } else if (state.phase === 'destination' && lower === 'y') return 'Belum ada saran tujuan. Ketik lokasi tujuan baru.';
    location = normalizeLocation(location);
    if (!location || location.length > 100 || /[\r\n\u0000-\u001f]/.test(input)) return 'Kirim lokasi yang valid, maksimal 100 karakter.';
    if (state.phase === 'source') {
      const row = state.locations.find(row => row.location === location);
      if (!row) return 'Lokasi asal tidak memiliki satu baris stok positif. Pilih lokasi dari daftar.';
      state.row = { ...state.row, lokasi_bulky: location, stok_akhir: row.qty };
      state.locations = state.locations.filter(row => row.location !== location).sort((a, b) => Number(locationPattern(b.location) === locationPattern(location)) - Number(locationPattern(a.location) === locationPattern(location)) || b.qty - a.qty);
      state.phase = 'destination'; state.locationPage = 1;
      await saveSearch(config, sender, state, fetchFn); return locationPrompt(state);
    }
    if (location === normalizeLocation(state.row.lokasi_bulky)) return 'To harus berbeda dari From. Kirim tujuan lain.';
    state.to = location; state.locations = undefined; state.phase = 'quantity';
    await saveSearch(config, sender, state, fetchFn); return qtyPrompt(state);
  }
  if (state.phase === 'quantity') {
    const qty = lower === 'y' ? Number(state.row.stok_akhir) : Number(input);
    if ((lower !== 'y' && !/^\d+(?:\.\d+)?$/.test(input)) || !Number.isFinite(qty) || qty <= 0 || qty > Number(state.row.stok_akhir)) return `Qty harus lebih dari 0 dan maksimal ${state.row.stok_akhir}.`;
    state.qty = qty; state.pic = resolvePic(profile.role); state.profile = profileData(profile); state.phase = 'confirm';
    await saveSearch(config, sender, state, fetchFn); return review(state);
  }
  if (lower !== 'y' && !retrying) return review(state);
  if (state.pic !== resolvePic(profile.role)) {
    state.pic = resolvePic(profile.role); state.profile = profileData(profile);
    await saveSearch(config, sender, state, fetchFn); return 'PIC berubah mengikuti konfigurasi role. Periksa ringkasan terbaru.\n\n' + review(state);
  }
  const claim = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?sender=eq.${encodeURIComponent(sender)}&search->>nonce=eq.${state.nonce}&search->>phase=eq.confirm&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'PATCH', headers: { ...headers(config), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ search: { ...state, phase: 'saving' } }), signal: AbortSignal.timeout(10000) });
  if (!claim.ok) return 'Penyimpanan belum dapat dimulai. Coba lagi.';
  if (!(await claim.json()).length) return 'Konfirmasi sudah diproses atau kedaluwarsa. Periksa WMS.';
  let reply, retryable = false, needsReview = false;
  try {
    const result = await commitMovement(env, state, fetchFn);
    reply = typeof result === 'string' ? result : result.reply; retryable = typeof result === 'string';
    if (result.reviewRequired) { state.row = result.row; needsReview = true; reply += '\n\n' + review(state); }
    if (result.saved) {
      try { await writeMovementAudit(config, profile, state, result, fetchFn); }
      catch { reply += '\nHistory WMS belum tercatat. Movement sudah tersimpan; jangan ulang transaksi.'; }
    }
  } catch (error) {
    retryable = error instanceof GoogleAccessError && !error.writeAttempted;
    console.error('[WHATSAPP_MOVEMENT_FAILED]', JSON.stringify({ code: error.code || 'UNKNOWN', reference: state.nonce }));
    reply = formatGoogleFailure(error, undefined, 'Movement dan Barang Masuk');
  }
  if (retryable) reply += '\n\nBalas ulang untuk mencoba lagi dengan data yang sama.';
  await saveSearch(config, sender, needsReview ? { ...state, phase: 'confirm' } : retryable ? { ...state, phase: 'retry' } : { kind: 'movement', phase: 'done', nonce: state.nonce }, fetchFn);
  return reply;
}
