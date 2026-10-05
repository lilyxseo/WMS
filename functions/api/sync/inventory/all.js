import { getRequestRole } from '../../_authz.js';
import { INVENTORY_SYNC_SOURCES } from './_inventory-runner.js';
import { inventorySyncJson } from './_manual-endpoint.js';

const SOURCE_NAMES = Object.freeze({
  kartu_stok: 'kartuStok',
  barang_masuk: 'barangMasuk',
  barang_keluar: 'barangKeluar',
  rpl: 'rpl',
  bulky: 'bulky',
});

function safeFailure(error) {
  return {
    success: false,
    reason: error?.code || 'SYNC_FAILED',
  };
}

// Keep the same sequential strategy as the production cron schedule. Each job can
// make many Google/Supabase subrequests, so intentionally do not fan these out.
export async function orchestrateInventorySync(env, dependencies = {}) {
  const startedAt = Date.now();
  const sourceEntries = dependencies.sources || INVENTORY_SYNC_SOURCES;
  const sources = {};

  for (const [source, sync] of sourceEntries) {
    const publicName = SOURCE_NAMES[source] || source;
    try {
      const result = await sync(env, dependencies.syncDependencies?.[source]);
      sources[publicName] = { ...result, success: result?.success === true };
    } catch (error) {
      console.error(`[InventorySyncAll:${source}] ${error?.code || 'SYNC_FAILED'}`);
      sources[publicName] = safeFailure(error);
    }
  }

  const outcomes = Object.values(sources);
  const succeeded = outcomes.filter(result => result.success).length;
  return {
    success: outcomes.length > 0 && succeeded === outcomes.length,
    partialSuccess: succeeded > 0 && succeeded < outcomes.length,
    sources,
    durationMs: Date.now() - startedAt,
  };
}

export async function handleInventorySyncAll({ request, env }, dependencies = {}) {
  if (!(await getRequestRole(request, env))) {
    return inventorySyncJson({ success: false, partialSuccess: false, reason: 'UNAUTHORIZED' }, 401);
  }
  const result = await (dependencies.run || orchestrateInventorySync)(env, dependencies);
  // A settled orchestration is a valid response even when individual sources fail.
  return inventorySyncJson(result, 200);
}

export function onRequestPost(context) {
  return handleInventorySyncAll(context);
}
