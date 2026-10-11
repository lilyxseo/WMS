import { loadSearch, saveSearch } from './sessions.js';
import { displayText } from './menu.js';
import { commitSheetEdit, hasGoogleCredentials } from './sheet-edit.js';
import { normalizeLocation, normalizeSku, normalizeText } from './sheet-normalization.js';

const FIELDS = [
  ['qty', 'Jumlah'], ['status', 'Status'], ['pic', 'PIC'], ['keterangan', 'Keterangan'],
  ['from_location', 'Asal'], ['to_location', 'Tujuan'], ['tanggal', 'Tanggal'], ['sku', 'SKU'], ['nama_barang', 'Nama barang'],
];
const fieldMenu = '*Pilih kolom yang diubah*\n' + FIELDS.map(([, label], i) => `${i + 1}. ${label}`).join('\n') + '\n\nBalas nomor kolom. Ketik batal untuk keluar.';
const editors = env => String(env.WHATSAPP_EDITOR_NUMBERS || '').split(',').map(value => value.replace(/\D/g, '').replace(/^0/, '62')).filter(Boolean);
export const canEdit = (env, sender) => editors(env).includes(sender);

function validate(field, value) {
  const text = value.trim();
  if (field === 'qty') {
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw new Error('Jumlah harus angka 0 atau lebih, misalnya 12.');
    return Number(text);
  }
  if (field === 'tanggal') {
    const date = new Date(`${text}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error('Tanggal harus valid, format YYYY-MM-DD.');
  }
  if (!text || text.length > 300) throw new Error('Nilai wajib diisi, maksimal 300 karakter.');
  if (field === 'from_location' || field === 'to_location') return normalizeLocation(text);
  if (field === 'sku') return normalizeSku(text);
  return normalizeText(text);
}

export async function handleEdit(message, sender, env, config, fetchFn) {
  const input = message.trim(), lower = input.toLowerCase();
  const start = /^edit\s+(\d+)$/i.exec(input);
  let state;
  // Load context only for an edit command or a potential reply to its wizard.
  if (start || /^(simpan|batal|ubah|menu)$/.test(lower) || /^\d+$/.test(input)) state = await loadSearch(config, sender, fetchFn);
  else if (!/^(menu|help|bantuan|halo|hai|mulai|start|lanjut|berikutnya|sebelumnya|y|n)$/.test(lower)) {
    state = await loadSearch(config, sender, fetchFn);
  }
  if (state?.phase === 'done' && lower === 'simpan') return 'Edit sebelumnya sudah diproses. Cari ulang transaksi sebelum mengedit lagi.';
  const editing = state?.phase && ['field', 'value', 'confirm', 'saving'].includes(state.phase);
  if (lower === 'menu' && editing && state.phase !== 'saving') {
    await saveSearch(config, sender, state.context || {}, fetchFn);
    return undefined;
  }
  if (!start && !editing && /^(simpan|ubah|batal)$/.test(lower)) return 'Tidak ada draft edit aktif. Cari transaksi lalu balas edit 1.';
  if (!start && !editing) return undefined;
  if (!canEdit(env, sender)) return 'Nomor Anda belum memiliki izin edit. Pencarian tetap dapat digunakan.';
  if (!hasGoogleCredentials(env) || !env.SHEET_ID_2026) return 'Edit belum dikonfigurasi. Admin perlu mengisi kredensial Google OAuth atau Service Account, serta SHEET_ID_2026 di Supabase Secrets.';
  if (lower === 'batal') { await saveSearch(config, sender, { ...(state.context || {}), phase: 'done' }, fetchFn); return 'Edit dibatalkan. Kirim pencarian baru untuk melanjutkan.'; }
  if (start) {
    if (!state || !/^Barang (Masuk|Keluar)$/.test(state.source) || !state.rows?.[Number(start[1]) - 1]) return 'Cari transaksi dahulu, misalnya masuk merlyn, lalu balas edit 1 sesuai nomor hasil.';
    const row = state.rows[Number(start[1]) - 1];
    if (!Number.isInteger(Number(row.source_row_number)) || Number(row.source_row_number) < 2) return 'Transaksi tidak memiliki nomor baris sumber yang valid. Cari ulang setelah sinkronisasi.';
    state = { phase: 'field', nonce: crypto.randomUUID(), source: state.source, row, updates: {}, context: { ...state, rows: undefined } };
    await saveSearch(config, sender, state, fetchFn);
    return `✏️ *Edit ${state.source}*\nSKU: ${displayText(row.sku)}\nBarang: ${displayText(row.nama_barang)}\nTanggal: ${displayText(row.tanggal)}\n\n${fieldMenu}`;
  }
  if (state.phase === 'saving' || state.phase === 'done') return 'Edit sebelumnya sudah diproses. Cari ulang transaksi sebelum mengedit lagi.';
  if (lower === 'ubah') { state.phase = 'field'; await saveSearch(config, sender, state, fetchFn); return fieldMenu; }
  if (state.phase === 'field') {
    const field = FIELDS[Number(input) - 1];
    if (!field || !/^\d+$/.test(input)) return fieldMenu;
    state.field = field[0]; state.phase = 'value'; await saveSearch(config, sender, state, fetchFn);
    return `*${field[1]}*\nSaat ini: ${displayText(state.updates[state.field] ?? state.row[state.field])}\nKirim nilai baru${state.field === 'tanggal' ? ' (YYYY-MM-DD)' : ''}.\nKetik batal untuk keluar.`;
  }
  if (state.phase === 'value') {
    try { state.updates[state.field] = validate(state.field, input); } catch (error) { return error.message + '\nKirim nilai yang benar atau ketik batal.'; }
    state.phase = 'confirm'; await saveSearch(config, sender, state, fetchFn);
    return '*Tinjau perubahan*\n' + Object.entries(state.updates).map(([field, value]) => `${FIELDS.find(([key]) => key === field)[1]}: ${displayText(state.row[field])} → ${displayText(value)}`).join('\n') + '\n\nBalas simpan untuk menyimpan, ubah untuk kolom lain, atau batal.';
  }
  if (lower !== 'simpan') return 'Balas simpan, ubah, atau batal.';
  const claim = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?sender=eq.${encodeURIComponent(sender)}&search->>nonce=eq.${encodeURIComponent(state.nonce)}&search->>phase=eq.confirm&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, {
    method: 'PATCH', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ search: { ...state, phase: 'saving' } }), signal: AbortSignal.timeout(10000),
  });
  if (!claim.ok) return 'Penyimpanan belum dapat dimulai. Silakan coba lagi.';
  if (!(await claim.json()).length) return 'Konfirmasi sudah diproses atau kedaluwarsa. Cari ulang transaksi.';
  let reply;
  try { reply = await commitSheetEdit(env, config, state, fetchFn); }
  catch { reply = 'Penyimpanan gagal atau belum terkonfirmasi. Jangan mengulang otomatis; periksa data WMS lalu cari ulang transaksi.'; }
  await saveSearch(config, sender, { ...state.context, phase: 'done' }, fetchFn);
  return reply;
}
