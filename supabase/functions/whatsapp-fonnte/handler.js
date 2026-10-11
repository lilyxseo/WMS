import { handleGoogleCheck } from './google-check.js';
function getDatabaseConfig(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.WMS_SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing database configuration');
  return { url, key };
}
import { buildInventorySearchQuery, normalizeSearchQuery, inventorySearchGroups } from './inventory-search.js';
import { BOT_HELP, CommandError, parseAdvancedCommand, searchAdvancedInventory, formatAdvancedReply } from './commands.js';
import { resolveMenu, displayText, isMainMenu } from './menu.js';
import { formatTransactionRow } from './transactions.js';
import { loadSearch, saveSearch } from './sessions.js';
import { renderWelcome } from './welcome.js';
import { handleStock } from './stock.js';
import { findPhoneProfile, normalizePhone } from './profiles.js';
import { handleMovement } from './movement.js';
import { handleEdit, canEdit } from './edit.js';
import { handlePdfImport } from './pdf-import.js';
import { pdfAttachment } from './pdf-document.js';
import { handleDailySummary } from './daily-summary.js';
import { handleScheduledSummary } from './summary-scheduler.js';

const SOURCES = [
  ['Kartu Stock', 'inventory_kartu_stok'],
  ['Barang Masuk', 'inventory_barang_masuk'],
  ['Barang Keluar', 'inventory_barang_keluar'],
];
const HELP = BOT_HELP;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const phone = normalizePhone;

export function parseInventoryMessage(message) {
  const input = String(message ?? '').trim();
  if (!input || /^(help|bantuan|menu)$/i.test(input)) return null;
  if (input.length > 200) throw new Error('Pencarian maksimal 200 karakter.');
  const match = /^(sku|barang|nama(?:\s+barang)?|lokasi|cari)\s*[:=]?\s+(.+)$/i.exec(input);
  const mode = match ? match[1].toLowerCase() : 'cari';
  const query = normalizeSearchQuery(match ? match[2] : input);
  if (!inventorySearchGroups(query).length || inventorySearchGroups(query).some(part => part.length < 2)) throw new Error('Setiap pencarian minimal 2 karakter. Pisahkan pencarian dengan koma.');
  const fields = mode === 'sku' ? ['sku'] : mode === 'lokasi' ? ['lokasi_bulky']
    : mode === 'barang' || mode.startsWith('nama') ? ['nama_barang']
      : ['sku', 'nama_barang', 'lokasi_bulky'];
  return { query, fields };
}

export async function searchInventory(env, search, fetchFn = fetch) {
  const config = getDatabaseConfig(env);
  const filter = buildInventorySearchQuery(search.query, search.fields);
  const batches = await Promise.all(SOURCES.slice(0, 1).map(async ([source, table]) => {
    const response = await fetchFn(`${config.url}/rest/v1/${table}?select=sku,nama_barang,lokasi_bulky,stok_akhir${filter}&order=sku.asc,lokasi_bulky.asc,source_row_number.asc&limit=11`, {
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Inventory lookup failed');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid inventory response');
    return rows.map(row => ({ ...row, source }));
  }));
  return batches.flat();
}

export function formatInventoryReply(rows, limit = 10) {
  if (!rows.length) return 'Data tidak ditemukan. Coba SKU, nama barang, lokasi, atau kata lain.';
  const clean = displayText;
  const items = rows.slice(0, limit).map((row, index) =>
    /^Barang (Masuk|Keluar)$/.test(row.source) ? formatTransactionRow(row, index)
      : `*${index + 1}. ${clean(row.nama_barang)}*\nSKU: ${clean(row.sku)}\nBarang: ${clean(row.nama_barang)}\nLokasi: ${clean(row.lokasi_bulky)}\nStok: ${clean(row.stok_akhir)}`);
  return `${items.join('\n\n──────────\n\n')}`
    + (rows.length > limit ? `\n\nDitampilkan ${limit} baris pertama. Perjelas pencarian untuk hasil lainnya.` : '');
}

export async function handleFonnteWebhook({ request, env, extractPdf }, fetchFn = fetch) {
  if (request.method !== 'POST') return json({ success: false, message: 'Method not allowed' }, 405);
  if (request.headers.get('X-WMS-Action') === 'daily-summary') {
    try { return await handleScheduledSummary(request, env, getDatabaseConfig(env), fetchFn); }
    catch { return json({ success: false, message: 'Scheduled summary unavailable' }, 503); }
  }
  const secret = String(env.FONNTE_WEBHOOK_SECRET || '');
  const allowed = String(env.WHATSAPP_ALLOWED_NUMBERS || '').split(',').map(phone).filter(Boolean);
  if (!secret || !env.FONNTE_TOKEN) return json({ success: false, message: 'Bot belum dikonfigurasi' }, 503);
  const received = request.headers.get('X-Webhook-Secret') || new URL(request.url).searchParams.get('secret');
  if (received !== secret) return json({ success: false }, 401);
  let payload;
  try {
    if (request.headers.get('Content-Type')?.includes('application/json')) payload = await request.json();
    else payload = Object.fromEntries(await request.formData());
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid payload');
  } catch { return json({ success: false, message: 'Payload tidak valid' }, 400); }
  // Ignore groups, outbound/status callbacks and invalid sender identities.
  const sender = String(payload.sender || '');
  if (!/^62\d{8,13}$/.test(phone(sender)) || sender.includes('@') || payload.isGroup === true || payload.isGroup === 'true'
    || payload.fromMe === true || payload.fromMe === 'true'
    || typeof payload.message !== 'string' && !pdfAttachment(payload)) {
    return json({ success: true, ignored: true });
  }
  if (typeof payload.message !== 'string') payload.message = '';
  let verifiedProfile;
  if (!allowed.includes(phone(sender))) {
    try {
      verifiedProfile = await findPhoneProfile(getDatabaseConfig(env), phone(sender), fetchFn);
      if (!verifiedProfile) return json({ success: true, ignored: true });
    } catch { return json({ success: false, message: 'Profil WhatsApp belum dapat diverifikasi' }, 503); }
  }
  let reply;
  try {
    const googleReply = !pdfAttachment(payload) ? await handleGoogleCheck(payload.message, env, fetchFn) : undefined;
    const pdfReply = googleReply !== undefined ? googleReply : await handlePdfImport(payload, phone(sender), env, getDatabaseConfig(env), fetchFn, extractPdf || (async bytes => (await import('./pdf-runtime.js')).extractPdf(bytes)));
    const summaryReply = pdfReply !== undefined ? pdfReply : await handleDailySummary(payload.message, env, getDatabaseConfig(env), fetchFn);
    const stockReply = summaryReply !== undefined ? summaryReply : await handleStock(payload.message, phone(sender), env, getDatabaseConfig(env), fetchFn);
    const movementReply = stockReply !== undefined ? stockReply : await handleMovement(payload.message, phone(sender), env, getDatabaseConfig(env), fetchFn);
    const editReply = movementReply !== undefined ? movementReply : await handleEdit(payload.message, phone(sender), env, getDatabaseConfig(env), fetchFn);
    if (editReply !== undefined) reply = editReply;
    else {
    const answer = payload.message.trim().toLowerCase();
    const isAnswer = ['y', 'n'].includes(answer);
    const navigation = ['lanjut', 'berikutnya', 'sebelumnya'].includes(answer);
    const followup = isAnswer || navigation;
    let options;
    if (followup) {
      options = await loadSearch(getDatabaseConfig(env), phone(sender), fetchFn);
      if (!options) reply = 'Pencarian sebelumnya tidak tersedia atau sudah kedaluwarsa (15 menit). Kirim pencarian baru, misalnya merlyn a20-1.';
      else if (navigation) {
        if (answer !== 'sebelumnya' && options.hasMore === false) {
          reply = 'Sudah di halaman terakhir. Balas sebelumnya untuk kembali atau kirim pencarian baru.';
          options = undefined;
        } else if (answer === 'sebelumnya' && options.page <= 1) {
          reply = 'Anda sudah di halaman pertama. Balas lanjut jika masih ada hasil berikutnya.';
          options = undefined;
        } else options = { ...options, page: options.page + (answer === 'sebelumnya' ? -1 : 1) };
      } else if (/^Barang (Masuk|Keluar)$/.test(options.source)) {
        reply = 'Pilihan y/n hanya untuk stok Kartu Stok. Balas lanjut atau sebelumnya untuk navigasi transaksi.';
        options = undefined;
      } else {
        options = { ...options, page: 1, stock: 'semua', hideZero: answer === 'n' };
        options.command = options.command.replace(/;\s*stok\s*=\s*[^;]+/ig, '').trim();
        if (answer === 'y') options.command += '; stok=semua';
      }
    }
    const menu = resolveMenu(payload.message);
    const advanced = !followup && menu === undefined ? parseAdvancedCommand(payload.message) : undefined;
    if (!followup && menu !== undefined) {
      if (isMainMenu(payload.message)) {
        if (!verifiedProfile) {
          try { verifiedProfile = await findPhoneProfile(getDatabaseConfig(env), phone(sender), fetchFn); }
          catch { /* Existing allowed numbers may keep opening the menu without a readable profile. */ }
        }
        reply = `${renderWelcome(verifiedProfile, new Date(), env.BUSINESS_TIME_ZONE || 'Asia/Jakarta')}\n\n${menu}`;
      } else reply = menu;
    }
    else if (!followup && advanced) options = advanced;
    else if (!followup) {
      const search = parseInventoryMessage(payload.message);
      if (!search) reply = HELP;
      else {
        options = { page: 1, source: '', stock: 'semua', hideZero: true, filters: [search], command: payload.message.trim() };
      }
    }
    if (options) {
      if (!['', 'Kartu Stock', 'Barang Masuk', 'Barang Keluar'].includes(options.source)) throw new CommandError('Pencarian global hanya memakai Kartu Stok. Gunakan masuk/keluar untuk transaksi.');
      const result = await searchAdvancedInventory(env, options, fetchFn, SOURCES, getDatabaseConfig(env));
      reply = formatAdvancedReply(result, options, formatInventoryReply);
      await saveSearch(getDatabaseConfig(env), phone(sender), { ...options, hasMore: result.hasMore, rows: /^Barang (Masuk|Keluar)$/.test(options.source) ? result.rows : undefined }, fetchFn);
      if (/^Barang (Masuk|Keluar)$/.test(options.source) && result.rows.length && canEdit(env, phone(sender))) reply += '\n\nUntuk edit, balas edit 1 sesuai nomor transaksi.';
      if (!options.source || options.source === 'Kartu Stock') {
        reply += '\n\n*Tampilkan stok 0? y/n*\ny = stok 0 dan stok yang masih ada\nn = sembunyikan stok 0\nPilihan berlaku untuk pencarian ini selama 15 menit.';
      }
    }
    }
  } catch (error) {
    reply = error instanceof CommandError || error.message.startsWith('Pencarian ')
      ? `⚠️ *Periksa perintah pencarian*\n${error.message}\n\nKetik menu untuk contoh yang tersedia.`
      : '⚠️ *Pencarian belum tersedia*\nDatabase WMS belum dapat diakses. Silakan coba lagi nanti.';
  }
  try {
    const response = await fetchFn('https://api.fonnte.com/send', {
      method: 'POST', headers: { Authorization: env.FONNTE_TOKEN },
      body: new URLSearchParams({ target: phone(sender), message: reply, countryCode: '62' }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok || result.status !== true) throw new Error('Send failed');
    return json({ success: true });
  } catch { return json({ success: false, message: 'Balasan WhatsApp gagal dikirim' }, 502); }
}
