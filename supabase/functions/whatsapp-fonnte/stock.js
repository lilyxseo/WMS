import { loadSearch, saveSearch } from './sessions.js';
import { displayText } from './menu.js';
import { buildInventorySearchQuery } from './inventory-search.js';
import { normalizeLocation, normalizeText } from './sheet-normalization.js';
import { requireStockProfile, ProfileError } from './profiles.js';
import { commitStock } from './sheet-stock.js';

const headers = config => ({ apikey: config.key, Authorization: `Bearer ${config.key}` });
const label = state => state.direction === 'in' ? 'Stock In' : 'Stock Out';
const review = state => `📦 *Tinjau ${label(state)}*\nBarang: ${displayText(state.row.nama_barang)}\nSKU: ${displayText(state.row.sku)}\nLokasi ${state.direction === 'in' ? 'tujuan' : 'asal'}: ${displayText(state.location)}\nQty: ${state.qty}\nPIC: ${displayText(state.profile.full_name)}\n\nTanggal dan status diisi otomatis saat disimpan.\nBalas simpan, ubah untuk mulai ulang, atau batal.`;
const prompt = state => `*${label(state)}*\nKirim SKU atau nama barang. Bisa digabung lokasi.\nContoh: merlyn a20-1\n\nKetik batal untuk keluar.`;

export async function handleStock(message, sender, env, config, fetchFn) {
  const input = message.trim(), lower = input.toLowerCase();
  const start = /^(?:stock|stok)[\s-]*(in|out)(?:\s+(.+))?$/i.exec(input);
  if (!start && /^(help|bantuan|halo|hai|mulai|start)$/.test(lower)) return undefined;
  let state = await loadSearch(config, sender, fetchFn);
  const active = state?.kind === 'stock';
  if (!start && !active) return undefined;
  // Keep an uncertain write protected, even if the sender starts another command.
  if (state?.phase === 'saving') return 'Transaksi sedang diproses atau belum terkonfirmasi. Periksa WMS sebelum mengulang.';
  if (!start && state.phase === 'done') {
    return lower === 'simpan' ? 'Stock in/out sebelumnya sudah diproses. Periksa WMS sebelum membuat transaksi baru.' : undefined;
  }
  if (active && (lower === 'batal' || lower === 'menu')) {
    await saveSearch(config, sender, {}, fetchFn);
    return lower === 'menu' ? undefined : 'Stock in/out dibatalkan. Tidak ada transaksi disimpan.';
  }
  let profile;
  try { profile = await requireStockProfile(config, sender, fetchFn); }
  catch (error) { if (error instanceof ProfileError) return error.message; throw error; }
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.SHEET_ID_2026) return 'Stock in/out belum dikonfigurasi. Admin perlu mengisi GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY dan SHEET_ID_2026 di Supabase Secrets.';
  if (active && !start && state.profile.id !== profile.id) return 'Profil nomor WhatsApp sudah berubah. Batalkan draft lalu mulai stock in/out baru.';
  if (start || lower === 'ubah') {
    state = { kind: 'stock', direction: start ? start[1].toLowerCase() : state.direction, phase: 'query', page: 1, nonce: crypto.randomUUID(), profile: { id: profile.id, full_name: normalizeText(profile.full_name), role: profile.role } };
    await saveSearch(config, sender, state, fetchFn);
    if (!start?.[2]) return prompt(state);
  }
  if (state.phase === 'query' || state.phase === 'select') {
    if (state.phase === 'select' && /^\d+$/.test(input)) {
      const row = state.rows[Number(input) - 1];
      if (!row) return 'Nomor barang tidak tersedia. Pilih nomor hasil atau kirim pencarian baru.';
      state = { ...state, row, rows: undefined, phase: 'location' };
      await saveSearch(config, sender, state, fetchFn);
      return `*Lokasi ${state.direction === 'in' ? 'tujuan' : 'asal'}*\nBarang: ${displayText(row.nama_barang)}\nSKU: ${displayText(row.sku)}\nLokasi hasil: ${displayText(row.lokasi_bulky)}\n\nKirim lokasi atau balas sama untuk memakai lokasi hasil.`;
    }
    if (state.phase === 'select' && /^(lanjut|berikutnya|sebelumnya)$/.test(lower)) {
      if (lower === 'sebelumnya' && state.page === 1) return 'Sudah di halaman pertama.';
      if (lower !== 'sebelumnya' && !state.hasMore) return 'Sudah di halaman terakhir.';
      state.page += lower === 'sebelumnya' ? -1 : 1;
    } else {
      state.query = start?.[2] || input; state.page = 1;
      if (state.query.length < 2 || state.query.length > 200) return 'Pencarian harus 2–200 karakter. Kirim SKU atau nama barang.';
    }
    const filter = buildInventorySearchQuery(state.query, ['sku', 'nama_barang', 'lokasi_bulky']);
    const response = await fetchFn(`${config.url}/rest/v1/inventory_kartu_stok?select=sku,nama_barang,lokasi_bulky,stok_akhir,source_row_number${state.direction === 'out' ? '&stok_akhir=gt.0' : ''}${filter}&order=sku.asc,lokasi_bulky.asc,source_row_number.asc&limit=11&offset=${(state.page - 1) * 10}`, { headers: headers(config), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Stock search failed');
    const rows = await response.json();
    state.rows = rows.slice(0, 10); state.hasMore = rows.length > 10; state.phase = rows.length ? 'select' : 'query';
    await saveSearch(config, sender, state, fetchFn);
    if (!rows.length) return `Barang${state.direction === 'out' ? ' dengan stok tersedia' : ''} tidak ditemukan. Kirim pencarian lain.`;
    return `*${label(state)} • Pilih barang*\n\n` + state.rows.map((row, i) => `*${i + 1}. ${displayText(row.nama_barang)}*\nSKU: ${displayText(row.sku)}\nLokasi: ${displayText(row.lokasi_bulky)} • Stok: ${displayText(row.stok_akhir)}`).join('\n\n') + `\n\nHalaman ${state.page}. Balas nomor barang.` + (state.hasMore ? '\nBalas lanjut untuk hasil lainnya.' : '') + (state.page > 1 ? '\nBalas sebelumnya untuk kembali.' : '');
  }
  if (state.phase === 'location') {
    const location = normalizeLocation(lower === 'sama' ? state.row.lokasi_bulky : input);
    if (!location || location.length > 100 || /[\r\n\u0000-\u001f]/.test(input)) return 'Kirim lokasi yang valid, maksimal 100 karakter.';
    // Validate the location belongs to this SKU; stock in can use a new location.
    if (state.direction === 'out') {
      const response = await fetchFn(`${config.url}/rest/v1/inventory_kartu_stok?select=stok_akhir&sku=eq.${encodeURIComponent(state.row.sku)}&lokasi_bulky=eq.${encodeURIComponent(location)}&limit=2`, { headers: headers(config), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Stock location read failed');
      const rows = await response.json();
      if (rows.length !== 1 || !Number.isFinite(Number(rows[0].stok_akhir)) || Number(rows[0].stok_akhir) <= 0) return 'SKU tidak memiliki satu baris stok positif di lokasi tersebut. Kirim lokasi asal lain.';
      state.available = Number(rows[0].stok_akhir);
    }
    state.location = location; state.phase = 'quantity'; await saveSearch(config, sender, state, fetchFn);
    return `*Qty ${label(state)}*\nKirim jumlah lebih dari 0${state.direction === 'out' ? `, maksimal ${state.available}` : ''}.`;
  }
  if (state.phase === 'quantity') {
    const qty = Number(input);
    if (!/^\d+(?:\.\d+)?$/.test(input) || !Number.isFinite(qty) || qty <= 0 || (state.direction === 'out' && qty > state.available)) return `Qty harus lebih dari 0${state.direction === 'out' ? ` dan maksimal ${state.available}` : ''}. Kirim jumlah yang benar.`;
    state.qty = qty; state.profile = { id: profile.id, full_name: normalizeText(profile.full_name), role: profile.role }; state.phase = 'confirm';
    await saveSearch(config, sender, state, fetchFn); return review(state);
  }
  if (lower !== 'simpan') return review(state);
  if (state.profile.full_name !== normalizeText(profile.full_name)) {
    state.profile.full_name = normalizeText(profile.full_name); state.profile.role = profile.role;
    await saveSearch(config, sender, state, fetchFn);
    return 'Nama PIC profil berubah. Periksa ringkasan terbaru sebelum menyimpan.\n\n' + review(state);
  }
  const claim = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?sender=eq.${encodeURIComponent(sender)}&search->>nonce=eq.${state.nonce}&search->>phase=eq.confirm&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'PATCH', headers: { ...headers(config), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ search: { ...state, phase: 'saving' } }), signal: AbortSignal.timeout(10000) });
  if (!claim.ok) return 'Penyimpanan belum dapat dimulai. Coba lagi.';
  if (!(await claim.json()).length) return 'Konfirmasi sudah diproses atau kedaluwarsa. Periksa WMS.';
  let reply;
  try { reply = await commitStock(env, state, fetchFn); }
  catch { reply = `Penyimpanan gagal atau belum terkonfirmasi. Jangan mengulang sebelum memeriksa Barang ${state.direction === 'in' ? 'Masuk' : 'Keluar'} di WMS.\nReferensi: ${state.nonce}`; }
  await saveSearch(config, sender, { kind: 'stock', phase: 'done', nonce: state.nonce, direction: state.direction }, fetchFn);
  return reply;
}
