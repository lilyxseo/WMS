import {getSecretSupabaseConfig} from './_supabase-config.js';
import {queryInventoryWarnings} from './_inventory-warnings.js';
export async function readWarningSnapshot(env,options={}){
 const {url,key}=getSecretSupabaseConfig(env),response=await fetch(url+'/rest/v1/inventory_warning_snapshot?select=payload,published_at,last_attempt_at,last_error&limit=1',{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)}),body=await response.json();
 if(!response.ok||!Array.isArray(body)||!body[0]?.payload||!Array.isArray(body[0].payload.rows))throw Error('Hasil pemeriksaan server belum tersedia. Coba muat ulang beberapa saat lagi.');
 const record=body[0],snapshot=record.payload,snapshotStale=!!record.last_error||Date.now()-Date.parse(record.published_at)>15*60*1000;
 return {...snapshot,...queryInventoryWarnings(snapshot.rows,options),partial:!!snapshot.partial||snapshotStale,snapshotStale,snapshotPublishedAt:record.published_at,lastAttemptAt:record.last_attempt_at,refreshMessage:record.last_error||'',mode:'stored_snapshot'};
}
