import {getSecretSupabaseConfig} from './_supabase-config.js';
import {queryInventoryWarnings} from './_inventory-warnings.js';
export async function readWarningSnapshot(env,options={}){
 const {url,key}=getSecretSupabaseConfig(env),response=await fetch(url+`/rest/v1/inventory_warning_snapshot?select=payload,published_at,last_attempt_at,last_error${options.notifications?',observed_payload,observed_at':''}&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)}),body=await response.json();
 if(!response.ok||!Array.isArray(body)||!body[0]?.payload||!Array.isArray(body[0].payload.rows))throw Error('Hasil pemeriksaan server belum tersedia. Coba muat ulang beberapa saat lagi.');
 const record=body[0],observed=options.notifications&&Array.isArray(record.observed_payload?.rows)&&record.observed_at&&(!record.published_at||Date.parse(record.observed_at)>=Date.parse(record.published_at)),snapshot=observed?record.observed_payload:record.payload,publishedAt=observed?record.observed_at:record.published_at,age=Date.now()-Date.parse(publishedAt),snapshotStale=(!observed&&!!record.last_error)||!Number.isFinite(age)||age<0||age>15*60*1000;
 return {...snapshot,...queryInventoryWarnings(snapshot.rows,options),partial:!!snapshot.partial||snapshotStale,snapshotStale,snapshotPublishedAt:publishedAt,lastAttemptAt:record.last_attempt_at,refreshMessage:record.last_error||'',mode:'stored_snapshot'};
}
