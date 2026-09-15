import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';
import { supabaseRows } from './_transaction-read.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
const number = value => Number(value) || 0;
const safe = value => String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
const fmt = value => new Intl.NumberFormat('id-ID').format(Math.round(number(value)));
const monthKey = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const group = rows => rows.reduce((map, row) => { const sku = String(row.sku || '').trim(); if (sku) map.set(sku, (map.get(sku) || 0) + number(row.qty)); return map; }, new Map());
const top = rows => [...group(rows)].sort((a, b) => b[1] - a[1])[0] || ['', 0];
const sum = rows => rows.reduce((total, row) => total + number(row.qty), 0);
async function readPeriod(config, table, select, start) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await supabaseRows(config, `${table}?select=${select}&tanggal=gte.${start}&order=tanggal.desc&offset=${offset}&limit=1000`);
    rows.push(...result.payload);
    if (result.payload.length < 1000) return rows;
  }
}

export async function handleDashboardMonthlyInsightRequest({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try {
    const config = getSecretSupabaseConfig(env);
    const now = new Date();
    const current = monthKey(now);
    const previousDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const previous = monthKey(previousDate);
    const start = `${previous}-01`;
    const select = 'tanggal,sku,qty,from_location,to_location';
    const [masukResult, keluarResult] = await Promise.all([
      readPeriod(config, 'inventory_barang_masuk', select, start),
      readPeriod(config, 'inventory_barang_keluar', select, start),
    ]);
    const byMonth = (rows, month) => rows.filter(row => String(row.tanggal || '').slice(0, 7) === month);
    const curIn = byMonth(masukResult, current), prevIn = byMonth(masukResult, previous);
    const curOut = byMonth(keluarResult, current), prevOut = byMonth(keluarResult, previous);
    const inQty = sum(curIn), outQty = sum(curOut), prevInQty = sum(prevIn), prevOutQty = sum(prevOut);
    const [topOutSku, topOutQty] = top(curOut), [topInSku, topInQty] = top(curIn);
    const pct = (cur, prev) => prev ? Math.round(Math.abs(cur - prev) / Math.max(Math.abs(prev), 1) * 100) : (cur ? 100 : 0);
    const balance = outQty > inQty ? `Keluar lebih tinggi ${Math.round((outQty - inQty) / Math.max(inQty, 1) * 100)}%` : inQty > outQty ? `Masuk lebih tinggi ${Math.round((inQty - outQty) / Math.max(outQty, 1) * 100)}%` : 'Masuk dan keluar seimbang';
    const insights = [
      { key: 'balance', priority: outQty > inQty * 1.25 ? 80 : 50, icon: '📊', tone: outQty > inQty ? 'warn' : 'good', text: `${balance}. Masuk <strong>${fmt(inQty)}</strong>, keluar <strong>${fmt(outQty)}</strong> pcs.` },
      topOutSku && { key: 'topOut', priority: 60, icon: '🔥', tone: 'good', text: `SKU terlaris: <strong>${safe(topOutSku)}</strong>. Keluar <strong>${fmt(topOutQty)} pcs</strong> (${outQty >= prevOutQty ? 'naik' : 'turun'} ${pct(outQty, prevOutQty)}% vs bulan lalu).` },
      topInSku && { key: 'rankIn', priority: 38, icon: '🏆', tone: 'info', text: `Top SKU masuk: <strong>${safe(topInSku)}</strong> <strong>${fmt(topInQty)} pcs</strong>.` },
    ].filter(Boolean);
    const important = insights.slice().sort((a, b) => b.priority - a.priority)[0] || null;
    return json({ success: true, aggregates: { current, previous, inbound: { qty: inQty, rows: curIn.length, previousQty: prevInQty }, outbound: { qty: outQty, rows: curOut.length, previousQty: prevOutQty } }, insight: { empty: !insights.length, title: '💡 Auto Insight Bulanan', subtitle: 'Insight otomatis berdasarkan aktivitas gudang bulan ini.', monthLabel: now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }), important, insights } });
  } catch (error) {
    console.error('[DashboardMonthlyInsight]', error?.message || error);
    return json({ success: false, message: 'Gagal menghitung insight bulanan.' }, 502);
  }
}

export const onRequestGet = handleDashboardMonthlyInsightRequest;
