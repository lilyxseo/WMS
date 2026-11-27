import {getSecretSupabaseConfig} from './_supabase-config.js';
import {queryInventoryWarnings} from './_inventory-warnings.js';

const freshObservationMs = 15 * 60 * 1000;

export async function readWarningSnapshot(env,options={}){
 const {url,key}=getSecretSupabaseConfig(env);
 const response=await fetch(url+'/rest/v1/inventory_warning_snapshot?select=payload,published_at,last_attempt_at,last_error,observed_payload,observed_at&limit=1',{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
 const body=await response.json();
 if(!response.ok||!Array.isArray(body)||!body[0])throw Error('Hasil pemeriksaan server belum tersedia. Coba muat ulang beberapa saat lagi.');
 const record=body[0];
 const completeAt=Date.parse(record.published_at),observedAt=Date.parse(record.observed_at),observedAge=Date.now()-observedAt;
 const observation=record.observed_payload;
 const hasObservation=Array.isArray(observation?.rows)&&Number.isFinite(observedAt);
 const notifications=options.notifications===true;
 const observedForNotifications=notifications&&hasObservation&&(!Number.isFinite(completeAt)||observedAt>=completeAt);
 // A partial read can confirm a finding exists, but cannot confirm it disappeared.
 // If there are no verified findings, keep the baseline instead of showing zero.
 const observedForPage=!notifications&&hasObservation&&observedAge>=0&&observedAge<=freshObservationMs
  &&(!Number.isFinite(completeAt)||observedAt>completeAt)&&observation.partial===true
  &&observation.rows.length>0&&observation.verification?.some(source=>source.ready&&!source.stale);
 const latestAttemptIncomplete=hasObservation&&(!Number.isFinite(completeAt)||observedAt>completeAt)&&!!record.last_error;
 const incompleteSources=latestAttemptIncomplete?(observation.verification||[])
  .filter(source=>!source.ready).map(({source,reason,lastSuccess})=>({source,reason,lastSuccess})):[];
 const incompleteChecks=latestAttemptIncomplete?(observation.unavailableSources||[])
  .filter(key=>!incompleteSources.some(source=>source.source===key)):[];
 const useObservation=observedForNotifications||observedForPage;
 const snapshot=useObservation?observation:record.payload;
 const displayedAt=useObservation?record.observed_at:record.published_at;
 const age=Date.now()-Date.parse(displayedAt);
 const snapshotStale=(!useObservation&&!!record.last_error)||!Number.isFinite(age)||age<0||age>freshObservationMs;
 if(!snapshot||!Array.isArray(snapshot.rows))throw Error('Hasil pemeriksaan server belum tersedia.');
 return {...snapshot,...queryInventoryWarnings(snapshot.rows,options),partial:!!snapshot.partial||snapshotStale,snapshotStale,
  snapshotPublishedAt:displayedAt,partialObservation:observedForPage,baselinePublishedAt:record.published_at,
  lastAttemptAt:record.last_attempt_at,incompleteSources,incompleteChecks,refreshMessage:record.last_error||'',mode:'stored_snapshot'};
}
