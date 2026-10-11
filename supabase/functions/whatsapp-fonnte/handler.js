function getDatabaseConfig(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.WMS_SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing database configuration');
  return { url, key };
}
import { buildInventorySearchQuery, normalizeSearchQuery } from './inventory-search.js';
import { BOT_HELP, CommandError, parseAdvancedCommand, searchAdvancedInventory, formatAdvancedReply } from './commands.js';
import { resolveMenu, displayText } from './menu.js';
import { formatTransactionRow } from './transactions.js';

const SOURCES = [
  ['Kartu Stock', 'inventory_kartu_stok'],
  ['RPL', 'inventory_rpl'],
  ['BULKY', 'inventory_bulky'],
  ['Barang Masuk', 'inventory_barang_masuk'],
  ['Barang Keluar', 'inventory_barang_keluar'],
];
const HELP = BOT_HELP;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const phone = value => String(value ?? '').replace(/\D/g, '').replace(/^0/, '62');

export function parseInventoryMessage(message) {
  const input = String(message ?? '').trim();
  if (!input || /^(help|bantuan|menu)$/i.test(input)) return null;
  if (input.length > 200) throw new Error('Pencarian maksimal 200 karakter.');
  const match = /^(sku|barang|nama(?:\s+barang)?|lokasi|cari)\s*[:=]?\s+(.+)$/i.exec(input);
  const mode = match ? match[1].toLowerCase() : 'cari';
  const query = normalizeSearchQuery(match ? match[2] : input);
  if (query.length < 2) throw new Error('Pencarian minimal 2 karakter.');
  const fields = mode === 'sku' ? ['sku'] : mode === 'lokasi' ? ['lokasi_bulky']
    : mode === 'barang' || mode.startsWith('nama') ? ['nama_barang']
      : ['sku', 'nama_barang', 'lokasi_bulky'];
  return { query, fields };
}

export async function searchInventory(env, search, fetchFn = fetch) {
  const config = getDatabaseConfig(env);
  const filter = buildInventorySearchQuery(search.query, search.fields);
  const batches = await Promise.all(SOURCES.slice(0, 3).map(async ([source, table]) => {
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
      : `*${index + 1}. ${clean(row.nama_barang)}*\nSKU: ${clean(row.sku)}\nBarang: ${clean(row.nama_barang)}\nLokasi: ${clean(row.lokasi_bulky)}\nStok: ${clean(row.stok_akhir)}\nSumber: ${clean(row.source)}`);
  return `${items.join('\n\n──────────\n\n')}`
    + (rows.length > limit ? `\n\nDitampilkan ${limit} baris pertama. Perjelas pencarian untuk hasil lainnya.` : '');
}

export async function handleFonnteWebhook({ request, env }, fetchFn = fetch) {
  if (request.method !== 'POST') return json({ success: false, message: 'Method not allowed' }, 405);
  const secret = String(env.FONNTE_WEBHOOK_SECRET || '');
  const allowed = String(env.WHATSAPP_ALLOWED_NUMBERS || '').split(',').map(phone).filter(Boolean);
  if (!secret || !allowed.length || !env.FONNTE_TOKEN) return json({ success: false, message: 'Bot belum dikonfigurasi' }, 503);
  const received = request.headers.get('X-Webhook-Secret') || new URL(request.url).searchParams.get('secret');
  if (received !== secret) return json({ success: false }, 401);
  let payload;
  try {
    if (request.headers.get('Content-Type')?.includes('application/json')) payload = await request.json();
    else payload = Object.fromEntries(await request.formData());
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid payload');
  } catch { return json({ success: false, message: 'Payload tidak valid' }, 400); }
  // Ignore groups, outbound/status callbacks and senders outside the allowlist.
  const sender = String(payload.sender || '');
  if (sender.includes('@') || payload.isGroup === true || payload.isGroup === 'true'
    || payload.fromMe === true || payload.fromMe === 'true'
    || !allowed.includes(phone(sender)) || typeof payload.message !== 'string') {
    return json({ success: true, ignored: true });
  }
  let reply;
  try {
    const menu = resolveMenu(payload.message);
    const advanced = menu === undefined ? parseAdvancedCommand(payload.message) : undefined;
    if (menu !== undefined) reply = menu;
    else if (advanced) {
      const result = await searchAdvancedInventory(env, advanced, fetchFn, SOURCES, getDatabaseConfig(env));
      reply = formatAdvancedReply(result, advanced, formatInventoryReply);
    } else {
      const search = parseInventoryMessage(payload.message);
      if (!search) reply = HELP;
      else {
        const options = { page: 1, source: '', stock: 'semua', hideZero: true, filters: [search], command: payload.message.trim() };
        reply = formatAdvancedReply(await searchAdvancedInventory(env, options, fetchFn, SOURCES, getDatabaseConfig(env)), options, formatInventoryReply);
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
