import { loadSearch, saveSearch } from './sessions.js';
import { requireStockProfile, ProfileError } from './profiles.js';
import { hasGoogleCredentials } from './sheet-edit.js';
import { GoogleAccessError } from './google-errors.js';
import { displayText } from './menu.js';
import { PdfError, pdfAttachment, isDocumentPayload, pdfMediaStatus, downloadPdf, parsePdfPages, transferName, validateTransferRows } from './pdf-document.js';
import { commitPdfImport } from './sheet-pdf.js';

const help = '*Import PDF*\nKirim PDF transfer sebagai dokumen WhatsApp.\nPreview diperiksa sebelum sheet baru dibuat di Inventory.\n\nKetik batal untuk keluar.';
const dbHeaders = config => ({ apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' });
export function pdfDiagnostic(state) {
  const media = state?.kind === 'pdf-import' ? state.lastMedia : undefined;
  if (!media) return '*Cek PDF*\nBelum ada data lampiran untuk diperiksa, atau draft sudah kedaluwarsa. Kirim PDF sebagai dokumen, lalu ketik cek pdf.';
  const yes = value => value ? 'ada' : 'tidak ada';
  return `*Cek PDF • Webhook Fonnte*\nLink unduhan: ${yes(media.hasDownloadUrl)}\nNama file: ${yes(media.hasFilename)}\nMetadata dokumen: ${yes(media.documentDetected)}\nEkstensi: ${yes(media.hasExtension)}\nField media: ${media.fields?.join(', ') || 'tidak ada'}\n\n`
    + (media.hasDownloadUrl ? 'Link file diterima. Jika preview belum muncul, periksa balasan error terakhir dari bot.' : 'Fonnte belum meneruskan link unduhan pada pesan ini. Nama file atau caption saja belum cukup untuk membaca PDF. Salin hasil cek ini untuk pemeriksaan integrasi Fonnte.')
    + '\nPemeriksaan ini tidak membuat atau mengubah sheet.';
}
export function pdfPreview(state) {
  const page = state.page || 1, first = (page - 1) * 10, rows = state.rows.slice(first, first + 10);
  return `📄 *Tinjau Import PDF*\nSheet: ${displayText(state.header.transferNumber)}\nFrom: ${displayText(state.header.from)}\nTo: ${displayText(state.header.to)}\nReferensi transfer: ${displayText(state.header.referenceNumber)}\nItem: ${state.rows.length} • Total Qty: ${state.rows.reduce((sum,row) => sum + Number(row.qty),0)}\n\n`
    + rows.map((row,index) => `*${first + index + 1}. ${displayText(row.namaProduk)}*\nSKU: ${displayText(row.sku)} • Qty: ${row.qty}${row.catatan ? `\nCatatan: ${displayText(row.catatan)}` : ''}`).join('\n\n')
    + `\n\nHalaman ${page}/${Math.ceil(state.rows.length / 10)} • Item ${first + 1}–${first + rows.length}`
    + (first + 10 < state.rows.length ? '\nBerikutnya: lanjut.' : '') + (page > 1 ? '\nSebelumnya: sebelumnya.' : '')
    + (state.warnings?.length ? '\n⚠️ Beberapa kolom tambahan tidak terdeteksi dan akan kosong.' : '')
    + '\n\nBalas y untuk import, atau batal.\nKoreksi: nomor #T-007894 • from IWT E-COM • to GOTO\nEdit item: edit 1 qty 10 (sku/nama/catatan juga tersedia).';
}

async function claim(config, sender, state, fetchFn) {
  const response = await fetchFn(`${config.url}/rest/v1/whatsapp_search_sessions?sender=eq.${encodeURIComponent(sender)}&search->>nonce=eq.${state.nonce}&search->>phase=eq.${state.phase}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, {
    method: 'PATCH', headers: dbHeaders(config), body: JSON.stringify({ search: { ...state, phase: 'saving' } }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('PDF claim failed');
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function audit(config, profile, state, result, fetchFn) {
  const response = await fetchFn(`${config.url}/rest/v1/activity_logs`, { method: 'POST', headers: { ...dbHeaders(config), Prefer: 'return=minimal' }, body: JSON.stringify({
    user_id: profile.id, user_name: profile.email || profile.full_name || profile.id, role: profile.role,
    action: 'IMPORT', module: 'Import PDF Transfer', status: 'SUCCESS', reference: state.nonce,
    detail: `Import PDF Transfer ${result.sheetName}, ${result.importedRows} item, qty ${result.totalQty}.`,
    metadata: { source: 'WHATSAPP', transferNumber: result.sheetName, sheetName: result.sheetName, rowCount: result.importedRows, totalQty: result.totalQty, actor_email: profile.email || '' },
  }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('PDF audit failed');
}

export async function handlePdfImport(payload, sender, env, config, fetchFn, extractPdf) {
  const input = String(payload.message || '').trim(), lower = input.toLowerCase();
  const start = /^(?:import\s+pdf|pdf)$/i.test(input), diagnostic = /^cek\s+pdf$/i.test(input), document = isDocumentPayload(payload);
  let state = await loadSearch(config, sender, fetchFn);
  const attachment = pdfAttachment(payload, state?.kind === 'pdf-import');
  if (!start && !attachment && !document && !diagnostic && state?.kind !== 'pdf-import') return undefined;
  if (diagnostic && !attachment && !document) {
    try {
      const profile = await requireStockProfile(config,sender,fetchFn);
      if (state?.kind === 'pdf-import' && state.profileId !== profile.id) return 'Profil nomor berubah. Mulai import PDF baru sebelum memeriksa draft.';
      return pdfDiagnostic(state);
    } catch (error) { if (error instanceof ProfileError) return error.message.replace('stock in/out','import PDF'); throw error; }
  }
  if (attachment || document || state?.kind === 'pdf-import' && state.phase === 'file' && !start) {
    console.info('[WHATSAPP_PDF_MEDIA]', JSON.stringify({ hasDownloadUrl: Boolean(attachment?.url), hasFilename: Boolean(attachment?.filename || payload.filename || payload.fileName), documentDetected: document, hasExtension: typeof payload.extension === 'string' && Boolean(payload.extension.trim()) }));
  }
  if (state?.phase === 'saving') return 'Input sedang diproses atau belum terkonfirmasi. Periksa WMS sebelum mengulang.';
  // A PDF must not silently discard an unfinished stock/movement/edit transaction.
  if ((start || attachment || document) && state?.kind !== 'pdf-import' && state?.phase && state.phase !== 'done') return 'Selesaikan input yang sedang berjalan atau ketik batal, lalu kirim PDF.';
  if (!start && !attachment && !document && state?.phase === 'done') return ['y','ulang'].includes(lower) ? 'Import sebelumnya sudah diproses atau belum terkonfirmasi. Periksa Inventory sebelum import ulang.' : undefined;
  if (!start && !attachment && !document && ['batal','menu'].includes(lower)) {
    await saveSearch(config, sender, {}, fetchFn);
    return lower === 'menu' ? undefined : 'Import PDF dibatalkan. Tidak ada sheet dibuat.';
  }
  let profile;
  try { profile = await requireStockProfile(config, sender, fetchFn); }
  catch (error) { if (error instanceof ProfileError) return error.message.replace('stock in/out','import PDF'); throw error; }
  if (!hasGoogleCredentials(env) || !env.SHEET_ID_INVENTORY) return 'Import PDF belum dikonfigurasi. Periksa kredensial Google dan SHEET_ID_INVENTORY.';
  if (state?.kind === 'pdf-import' && state.profileId !== profile.id && !start && !attachment) return 'Profil nomor berubah. Batalkan draft lalu kirim PDF kembali.';
  try {
    const observed = attachment || document || state?.kind === 'pdf-import' && state.phase === 'file' && !start;
    const lastMedia = observed ? pdfMediaStatus(payload) : state?.lastMedia;
    if (observed && state?.kind === 'pdf-import') {
      state = { ...state, lastMedia }; await saveSearch(config,sender,state,fetchFn);
    }
    if (document && !attachment) {
      if (state?.kind !== 'pdf-import') await saveSearch(config, sender, { kind: 'pdf-import', phase: 'file', nonce: crypto.randomUUID(), profileId: profile.id, lastMedia }, fetchFn);
      return '⚠️ *Link PDF belum diterima*\nWebhook Fonnte memuat informasi dokumen, tetapi tidak menyertakan link unduhan. Nama file saja belum cukup untuk membaca PDF.\nKetik cek pdf untuk memeriksa data yang diterima bot. Draft tetap tersedia; tidak ada sheet dibuat.';
    }
    if (start || attachment) {
      if (!attachment) {
        state = { kind: 'pdf-import', phase: 'file', nonce: crypto.randomUUID(), profileId: profile.id };
        await saveSearch(config, sender, state, fetchFn); return help;
      }
      if (state?.kind !== 'pdf-import') {
        state = { kind: 'pdf-import', phase: 'file', nonce: crypto.randomUUID(), profileId: profile.id, lastMedia };
        await saveSearch(config,sender,state,fetchFn);
      }
      const bytes = await downloadPdf(attachment, env, fetchFn);
      let pages;
      try { pages = await extractPdf(bytes); }
      catch (error) {
        if (/maksimal|terlalu besar/.test(error.message || '')) throw new PdfError(error.message);
        throw new PdfError('PDF tidak dapat dibaca. Pastikan dokumen tidak rusak atau terkunci password, lalu kirim ulang.');
      }
      const parsed = parsePdfPages(pages);
      state = { kind: 'pdf-import', phase: parsed.header.transferNumber ? 'confirm' : 'number', nonce: crypto.randomUUID(), profileId: profile.id, page: 1, lastMedia, ...parsed };
      if (state.header.transferNumber) transferName(state.header.transferNumber);
      await saveSearch(config, sender, state, fetchFn);
      return state.phase === 'number' ? `PDF terbaca: ${state.rows.length} item. Nomor transfer belum terdeteksi.\nKirim nomor transfer untuk nama sheet, misalnya #T-007894.` : pdfPreview(state);
    }
    if (state.phase === 'file') return '*Menunggu dokumen PDF*\nPesan ini belum memuat link file yang bisa dibaca. Jika PDF sudah dikirim, ketik cek pdf untuk memeriksa data yang diteruskan Fonnte.\nTidak perlu memulai ulang import.\n\nKetik batal untuk keluar.';
    if (state.phase === 'number') {
      state.header.transferNumber = transferName(input.replace(/^nomor\s+/i,'')); state.phase = 'confirm';
      await saveSearch(config, sender, state, fetchFn); return pdfPreview(state);
    }
    if (/^(lanjut|berikutnya|sebelumnya|preview)$/.test(lower)) {
      const page = state.page || 1, next = page + (lower === 'sebelumnya' ? -1 : lower === 'preview' ? 0 : 1);
      if (next < 1 || next > Math.ceil(state.rows.length / 10)) return 'Halaman tidak tersedia.\n\n' + pdfPreview(state);
      state.page = next; await saveSearch(config, sender, state, fetchFn); return pdfPreview(state);
    }
    const headerEdit = /^(nomor|from|to|referensi)\s+(.+)$/i.exec(input);
    const itemEdit = /^edit\s+([1-9]\d*)\s+(sku|nama|qty|catatan)\s+(.+)$/i.exec(input);
    if (headerEdit) {
      const key = { nomor: 'transferNumber', from: 'from', to: 'to', referensi: 'referenceNumber' }[headerEdit[1].toLowerCase()];
      const value = headerEdit[2].trim();
      if (value.length > 300) throw new PdfError('Nilai header maksimal 300 karakter.');
      state.header[key] = key === 'transferNumber' ? transferName(value) : value;
    } else if (itemEdit) {
      const index = Number(itemEdit[1]) - 1, key = { sku: 'sku', nama: 'namaProduk', qty: 'qty', catatan: 'catatan' }[itemEdit[2].toLowerCase()];
      if (!state.rows[index]) throw new PdfError('Nomor item tidak tersedia.');
      const value = itemEdit[3].trim();
      if (value.length > 1000 || key === 'qty' && !/^\d+(?:\.\d+)?$/.test(value)) throw new PdfError('Nilai edit tidak valid. Qty memakai angka 0 atau lebih, misalnya 10.');
      const changed = { ...state.rows[index], [key]: key === 'qty' ? Number(value) : value };
      validateTransferRows([changed]); state.rows[index] = changed;
    }
    if (headerEdit || itemEdit) {
      state.phase = 'confirm'; await saveSearch(config, sender, state, fetchFn); return pdfPreview(state);
    }
    if (!(state.phase === 'confirm' && lower === 'y' || state.phase === 'retry' && lower === 'ulang')) {
      return state.phase === 'retry' ? 'Import belum dimulai. Balas ulang untuk mencoba dengan preview yang sama, preview, atau batal.' : pdfPreview(state);
    }
    if (!await claim(config, sender, state, fetchFn)) return 'Import sudah diproses atau draft kedaluwarsa. Periksa Inventory sebelum mengulang.';
    let result;
    try { result = await commitPdfImport(env, state, fetchFn); }
    catch (error) {
      const noWrite = error instanceof GoogleAccessError && !error.writeAttempted;
      await saveSearch(config, sender, { ...state, phase: noWrite ? 'retry' : 'done' }, fetchFn);
      return `${error instanceof GoogleAccessError ? error.userMessage : 'Import belum terkonfirmasi.'}\n${noWrite ? 'Tidak ada sheet dibuat. Balas ulang untuk mencoba dengan preview yang sama.' : 'Periksa Inventory sebelum mengulang import.'}`;
    }
    // Once Google confirms a write, subsequent session/audit errors must never suggest repeating it.
    let warning = '';
    try { await saveSearch(config, sender, { kind: 'pdf-import', phase: 'done', nonce: state.nonce, profileId: profile.id }, fetchFn); }
    catch { warning = '\nStatus bot belum diperbarui. Jangan mengulang import.'; }
    if (result.duplicate) return result.reply + warning;
    try { await audit(config, profile, state, result, fetchFn); }
    catch { warning += '\nLog aktivitas belum tercatat; data sheet sudah tersimpan.'; }
    return `✅ *Import PDF Berhasil*\nSheet: ${displayText(result.sheetName)}\nItem: ${result.importedRows}\nTotal Qty: ${result.totalQty}\nTersimpan di spreadsheet Inventory.${warning}\n\nKetik menu untuk melanjutkan.`;
  } catch (error) {
    if (error instanceof PdfError) return '⚠️ *Periksa PDF*\n' + error.message;
    throw error;
  }
}
