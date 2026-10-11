import { normalizeDate, normalizeNumber } from './sheet-normalization.js';
import { displayText } from './menu.js';

export function businessDate(now = new Date(), timeZone = 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function summaryDate(message, now = new Date(), timeZone = 'Asia/Jakarta') {
  const match = /^ringkasan(?:\s+(.*))?$/i.exec(String(message || '').trim());
  if (!match) return undefined;
  const query = String(match[1] || '').trim().toLowerCase(), today = businessDate(now, timeZone);
  if (!query || ['harian','hari ini','hariini'].includes(query)) return today;
  if (query === 'kemarin') {
    const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0,10);
  }
  const date = normalizeDate(query);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query) || !date.valid || date.value > today) throw new Error('Gunakan ringkasan, ringkasan kemarin, atau ringkasan YYYY-MM-DD (tanggal tidak melebihi hari ini).');
  return date.value;
}

function metric() { return { transactions: 0, qty: 0, skus: new Set(), pics: new Map(), invalidQty: 0 }; }
function record(target, row) {
  target.transactions++;
  const qty = normalizeNumber(row.qty);
  if (!qty.valid || qty.value == null) target.invalidQty++;
  else target.qty += qty.value;
  if (String(row.sku || '').trim()) target.skus.add(String(row.sku).trim());
  const pic = String(row.pic || '').trim();
  if (pic) target.pics.set(pic, (target.pics.get(pic) || 0) + 1);
}

export async function getDailySummary(config, date, fetchFn) {
  const incoming = metric(), outgoing = metric(), movement = metric();
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
  // Sync normalizes transaction dates to YYYY-MM-DD. Read all matching rows, not a fixed cap.
  await Promise.all(['inventory_barang_masuk','inventory_barang_keluar'].map(async table => {
    for (let offset = 0; ; offset += 1000) {
      const query = new URLSearchParams({ select: 'sku,qty,status,pic,keterangan', tanggal: `eq.${date}`, order: 'source_row_number.asc', offset: String(offset), limit: '1000' });
      const response = await fetchFn(`${config.url}/rest/v1/${table}?${query}`, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Daily summary read failed');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid daily summary response');
      for (const row of rows) {
        const isMovement = /\bmovement\b/i.test(String(row.status || '')) || /INTERNAL STOCK TRANSFER/i.test(String(row.keterangan || ''));
        if (table === 'inventory_barang_masuk') record(isMovement ? movement : incoming, row);
        // The transfer is counted from the incoming ledger once, never from both sides.
        else if (!isMovement) record(outgoing, row);
      }
      if (rows.length < 1000) break;
    }
  }));
  return { date, incoming, outgoing, movement };
}

export function formatDailySummary(summary, now = new Date(), timeZone = 'Asia/Jakarta') {
  const number = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 6 }).format(value);
  const sections = [['Barang Masuk',summary.incoming],['Barang Keluar',summary.outgoing],['Movement',summary.movement]];
  const count = sections.reduce((sum,[,value]) => sum + value.transactions,0);
  const warnings = sections.reduce((sum,[,value]) => sum + value.invalidQty,0);
  const time = new Intl.DateTimeFormat('id-ID', { timeZone, hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).format(now);
  const date = new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', weekday:'long',day:'numeric',month:'long',year:'numeric' }).format(new Date(`${summary.date}T12:00:00Z`));
  return `📊 *Ringkasan Harian WMS*\n${date}\n\n` + sections.map(([title,value]) => {
    const pics = [...value.pics].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,3);
    return `*${title}*\nTransaksi: ${number(value.transactions)}\nQty: ${number(value.qty)}\nSKU: ${number(value.skus.size)}` + (pics.length ? `\nPIC: ${pics.map(([name,total]) => `${displayText(name)} (${number(total)})`).join(', ')}` : '');
  }).join('\n\n')
    + `\n\n${count ? 'Movement dihitung terpisah dari Barang Masuk/Keluar.' : 'Belum ada transaksi pada tanggal ini.'}`
    + (warnings ? `\n⚠️ ${warnings} transaksi memiliki qty kosong/tidak valid dan tidak masuk total qty.` : '')
    + `\nWaktu laporan: ${time} (${timeZone}).\n\nKetik ringkasan kemarin atau ringkasan YYYY-MM-DD.`;
}

export async function handleDailySummary(message, env, config, fetchFn, now = new Date()) {
  let date;
  try { date = summaryDate(message, now, env.BUSINESS_TIME_ZONE || 'Asia/Jakarta'); }
  catch (error) { return error.message; }
  if (!date) return undefined;
  try { return formatDailySummary(await getDailySummary(config,date,fetchFn), now, env.BUSINESS_TIME_ZONE || 'Asia/Jakarta'); }
  catch { return '⚠️ Ringkasan belum dapat dibuat karena data transaksi WMS gagal dibaca. Ketik ringkasan untuk mencoba kembali.'; }
}
