import { hasGoogleCredentials } from './sheet-edit.js';
import { loadSearch, saveSearch } from './sessions.js';
import { canEdit } from './edit.js';
import { displayText } from './menu.js';
import { buildInventorySearchQuery } from './inventory-search.js';
import { normalizeLocation, normalizeText } from './sheet-normalization.js';
import { commitMovement } from './sheet-movement.js';

const headers = config => ({ apikey: config.key, Authorization: `Bearer ${config.key}` });
const prompt = '*Movement baru*\nKirim SKU, nama barang, atau gabungan lokasi.\nContoh: merlyn a20-1\n\nKetik batal untuk keluar.';
const review = state => `📦 *Tinjau movement*\nBarang: ${displayText(state.row.nama_barang)}\nSKU: ${displayText(state.row.sku)}\nAsal: ${displayText(state.row.lokasi_bulky)}\nTujuan: ${displayText(state.to)}\nJumlah: ${state.qty}\nStok asal saat dipilih: ${state.row.stok_akhir}\nPIC: ${displayText(state.pic)}\n\nBalas simpan, ubah untuk mulai ulang, atau batal.`;

export async function handleMovement(message, sender, env, config, fetchFn) {
  const input = message.trim(), lower = input.toLowerCase();
  const start = /^movement(?:\s+(.+))?$/i.exec(input);
  // Menu/help without an active movement need no extra database lookup.
  if (!start && /^(help|bantuan|halo|hai|mulai|start)$/.test(lower)) return undefined;
  let state = await loadSearch(config, sender, fetchFn);
  if (!start && state?.kind !== 'movement') return undefined;
  if (!start && state.phase === 'done') {
    if (lower === 'simpan') return 'Movement sebelumnya sudah diproses. Periksa data WMS sebelum membuat movement baru.';
    return undefined;
  }
  if (state?.kind === 'movement' && state.phase === 'saving') return 'Movement sedang diproses atau belum terkonfirmasi. Periksa WMS sebelum mengulang.';
  if (!canEdit(env, sender)) return 'Nomor Anda belum memiliki izin movement. Hubungi admin untuk akses editor.';
  if (!hasGoogleCredentials(env) || !env.SHEET_ID_2026 || !env.SHEET_ID_INVENTORY) return 'Movement belum dikonfigurasi. Admin perlu mengisi kredensial Google OAuth atau Service Account, SHEET_ID_2026 dan SHEET_ID_INVENTORY di Supabase Secrets.';
  if (lower === 'batal' || lower === 'menu') {
    await saveSearch(config, sender, {}, fetchFn);
    return lower === 'menu' ? undefined : 'Movement dibatalkan. Tidak ada data disimpan.';
  }
  if (start || lower === 'ubah') {
    state = { kind: 'movement', phase: 'query', nonce: crypto.randomUUID(), page: 1 };
    await saveSearch(config, sender, state, fetchFn);
    if (!start?.[1]) return prompt;
  }
  if (state.phase === 'query' || state.phase === 'select') {
    if (state.phase === 'select' && /^\d+$/.test(input)) {
      const row = state.rows[Number(input) - 1];
      if (!row) return 'Nomor barang tidak tersedia. Pilih nomor hasil atau kirim kata pencarian baru.';
      state = { ...state, row, rows: undefined, phase: 'destination' };
      await saveSearch(config, sender, state, fetchFn);
      return `*Lokasi tujuan*\n${displayText(row.nama_barang)}\nAsal: ${displayText(row.lokasi_bulky)} • Stok: ${row.stok_akhir}\n\nKirim lokasi tujuan. Ketik batal untuk keluar.`;
    }
    if (state.phase === 'select' && /^(lanjut|berikutnya|sebelumnya)$/.test(lower)) {
      if (lower === 'sebelumnya' && state.page === 1) return 'Sudah di halaman pertama.';
      if (lower !== 'sebelumnya' && !state.hasMore) return 'Sudah di halaman terakhir.';
      state.page += lower === 'sebelumnya' ? -1 : 1;
    } else {
      state.query = start?.[1] || input; state.page = 1;
      if (state.query.length < 2 || state.query.length > 200) return 'Pencarian harus 2–200 karakter. ' + prompt;
    }
    const filter = buildInventorySearchQuery(state.query, ['sku', 'nama_barang', 'lokasi_bulky']);
    const response = await fetchFn(`${config.url}/rest/v1/inventory_kartu_stok?select=sku,nama_barang,lokasi_bulky,stok_akhir,source_row_number&stok_akhir=gt.0${filter}&order=sku.asc,lokasi_bulky.asc,source_row_number.asc&limit=11&offset=${(state.page - 1) * 10}`, { headers: headers(config), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Movement search failed');
    const rows = await response.json();
    state.rows = rows.slice(0, 10); state.hasMore = rows.length > 10; state.phase = rows.length ? 'select' : 'query';
    await saveSearch(config, sender, state, fetchFn);
    if (!rows.length) return 'Barang dengan stok tersedia tidak ditemukan. Kirim kata pencarian lain.';
    return '*Pilih barang dan lokasi asal*\n\n' + state.rows.map((row, i) => `*${i + 1}. ${displayText(row.nama_barang)}*\nSKU: ${displayText(row.sku)}\nAsal: ${displayText(row.lokasi_bulky)} • Stok: ${row.stok_akhir}`).join('\n\n') + `\n\nHalaman ${state.page}. Balas nomor barang.` + (state.hasMore ? '\nBalas lanjut untuk hasil lainnya.' : '') + (state.page > 1 ? '\nBalas sebelumnya untuk kembali.' : '');
  }
  if (state.phase === 'destination') {
    const to = normalizeLocation(input);
    if (!to || to.length > 100 || /[\r\n\u0000-\u001f]/.test(input)) return 'Kirim lokasi tujuan yang valid, maksimal 100 karakter.';
    if (to === normalizeLocation(state.row.lokasi_bulky)) return 'Tujuan harus berbeda dari lokasi asal. Kirim tujuan lain.';
    state.to = to; state.phase = 'quantity'; await saveSearch(config, sender, state, fetchFn);
    return `*Jumlah dipindahkan*\nStok asal: ${state.row.stok_akhir}\nKirim jumlah lebih dari 0, maksimal ${state.row.stok_akhir}.`;
  }
  if (state.phase === 'quantity') {
    const qty = Number(input);
    if (!/^\d+(?:\.\d+)?$/.test(input) || !Number.isFinite(qty) || qty <= 0 || qty > Number(state.row.stok_akhir)) return `Jumlah harus lebih dari 0 dan maksimal ${state.row.stok_akhir}. Kirim jumlah yang benar.`;
    state.qty = qty; state.phase = 'pic'; await saveSearch(config, sender, state, fetchFn);
    return '*PIC movement*\nKirim nama PIC yang bertanggung jawab.';
  }
  if (state.phase === 'pic') {
    if (!input || input.length > 100 || /[\r\n\u0000-\u001f]/.test(input)) return 'Nama PIC wajib diisi, maksimal 100 karakter.';
    state.pic = normalizeText(input); state.phase = 'confirm'; await saveSearch(config, sender, state, fetchFn);
    return review(state);
  }
  if (lower !== 'simpan') return review(state);
  const claim = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?sender=eq.${encodeURIComponent(sender)}&search->>nonce=eq.${state.nonce}&search->>phase=eq.confirm&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'PATCH', headers: { ...headers(config), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ search: { ...state, phase: 'saving' } }), signal: AbortSignal.timeout(10000) });
  if (!claim.ok) return 'Penyimpanan belum dapat dimulai. Coba lagi.';
  if (!(await claim.json()).length) return 'Konfirmasi sudah diproses atau kedaluwarsa. Periksa WMS.';
  let reply;
  try { reply = await commitMovement(env, state, fetchFn); }
  catch { reply = `Penyimpanan gagal atau belum terkonfirmasi. Jangan ulang sebelum memeriksa Movement dan Barang Masuk di WMS.\nReferensi: ${state.nonce}`; }
  await saveSearch(config, sender, { kind: 'movement', phase: 'done', nonce: state.nonce }, fetchFn);
  return reply;
}
