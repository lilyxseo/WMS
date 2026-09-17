import { syncKartuStok } from './_kartu-stok-service.js';
import { syncBarangMasuk } from './_barang-masuk-service.js';
import { syncBarangKeluar } from './_barang-keluar-service.js';
import { syncRpl } from './_rpl-service.js';
import { syncBulky } from './_bulky-service.js';

export const INVENTORY_SYNC_SOURCES = Object.freeze([
  ['kartu_stok', syncKartuStok],
  ['barang_masuk', syncBarangMasuk],
  ['barang_keluar', syncBarangKeluar],
  ['rpl', syncRpl],
  ['bulky', syncBulky],
]);

export async function runInventorySync(env, dependencies = {}) {
  const sources = dependencies.sources || INVENTORY_SYNC_SOURCES;
  const results = [];

  for (const [source, sync] of sources) {
    try {
      const result = await sync(env, dependencies.syncDependencies?.[source]);
      results.push({ source, ...result });
    } catch (error) {
      results.push({
        success: false,
        source,
        reason: error?.code || 'SYNC_FAILED',
        message: error?.message || String(error),
        ...(error?.code === 'INVALID_HEADER' ? {
          missingHeader: error.missingHeader,
          headerRowNumber: error.headerRowNumber,
          detectedHeaders: error.detectedHeaders,
          normalizedHeaders: error.normalizedHeaders,
        } : {}),
      });
    }
  }

  return {
    success: results.every(result => result.success === true),
    results,
  };
}
