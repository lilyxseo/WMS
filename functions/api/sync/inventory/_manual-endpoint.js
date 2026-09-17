import { SyncError } from './_sync-engine.js';

export function inventorySyncJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const maximumLength = Math.max(left.length, right.length); let difference = left.length ^ right.length;
  for (let index = 0; index < maximumLength; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}
export function isInventorySyncAuthorized(request, env) {
  const authorization = String(request.headers.get('authorization') || '');
  const suppliedSecret = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  const expectedSecret = String(env?.INVENTORY_SYNC_SECRET || '');
  return Boolean(expectedSecret) && constantTimeEqual(suppliedSecret, expectedSecret);
}
export async function handleManualInventorySync({ request, env }, { source, sync }) {
  if (!isInventorySyncAuthorized(request, env)) return inventorySyncJson({ success: false, reason: 'UNAUTHORIZED' }, 401);
  try {
    const result = await sync(env);
    return inventorySyncJson(result, result.skipped ? 409 : 200);
  } catch (error) {
    console.error(`[InventorySync:${source}] ERROR ${error?.code || 'SYNC_FAILED'}: ${error?.message || error}`);
    const headerDebug = error instanceof SyncError && error.code === 'INVALID_HEADER' ? {
      missingHeader: error.missingHeader,
      headerRowNumber: error.headerRowNumber,
      detectedHeaders: error.detectedHeaders,
      normalizedHeaders: error.normalizedHeaders,
    } : {};
    return inventorySyncJson({ success: false, source, reason: error instanceof SyncError ? error.code : 'SYNC_FAILED', message: error?.message || 'Sinkronisasi gagal', ...headerDebug }, 500);
  }
}
