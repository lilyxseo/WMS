// Drafts/auth/preferences are never evicted. These keys contain rebuildable server data only.
const REBUILDABLE=new Set(['inventoryCache','movementCache','barangMasukCache','barangKeluarCache','kartuStockCache','rplCache','bulkyCache','balikanStoreCache','cycleCountCache','activityLogCache','anomalyCacheV1','ABC_ANALYSIS_CACHE','barangRejectCacheV1','stokMinusCacheV3']);
export function writeDraftValue(storage,key,value){try{storage.setItem(key,value);return true;}catch(error){if(error?.name!=='QuotaExceededError'&&error?.name!=='NS_ERROR_DOM_QUOTA_REACHED'&&error?.code!==22&&error?.code!==1014)return false;}
 const caches=new Set(REBUILDABLE);try{for(let index=0;index<storage.length;index++){const existing=storage.key(index);if(existing?.startsWith('balikanStoreCache:'))caches.add(existing);}}catch{}
 for(const cache of caches){try{storage.removeItem(cache);}catch{}}
 try{storage.setItem(key,value);return true;}catch{return false;}
}
