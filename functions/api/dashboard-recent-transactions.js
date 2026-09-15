import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';
import { TRANSACTION_COLUMNS, transactionPage } from './_transaction-read.js';
import { mapBarangMasukRow } from './barang-masuk/index.js';
import { mapBarangKeluarRow } from './barang-keluar/index.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=30' } });

export async function handleDashboardRecentTransactionsRequest({ request, env }) {
  if (!(await getRequestRole(request, env))) return json({ success: false, message: 'Sesi tidak valid' }, 401);
  try {
    const config = getSecretSupabaseConfig(env);
    const [masuk, keluar] = await Promise.all([
      transactionPage(config, 'inventory_barang_masuk', { columns: TRANSACTION_COLUMNS, limit: 50 }),
      transactionPage(config, 'inventory_barang_keluar', { columns: TRANSACTION_COLUMNS, limit: 50 }),
    ]);
    return json({ success: true, barangMasuk: masuk.rows.map(mapBarangMasukRow), barangKeluar: keluar.rows.map(mapBarangKeluarRow) });
  } catch (error) {
    console.error('[DashboardRecentTransactions]', error?.message || error);
    return json({ success: false, message: 'Gagal memuat transaksi terbaru.' }, 502);
  }
}

export const onRequestGet = handleDashboardRecentTransactionsRequest;
