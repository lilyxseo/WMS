import {getNoteIdentity} from './_note-identity.js';
import {archiveDeveloperRole} from '../../assets/js/archive-source-config.js';
import {workStore,json} from './_work-store.js';
export function warningHealthMessage(health,now=Date.now()){
 if(!health.recipients)return 'Tidak ada penerima Warning aktif dengan nomor WhatsApp valid.';
 if(health.dispatchCode==='CONFIG_MISSING')return 'URL atau secret bot belum dikonfigurasi di server.';
 if(!health.jobs?.some(job=>job.name==='wms-warning-notifications'&&job.active))return 'Jadwal notifikasi belum aktif.';
 if(!health.jobs?.some(job=>job.name==='wms-warning-snapshot'&&job.active))return 'Jadwal pemeriksaan warning belum aktif.';
 if(!health.lastDispatch||now-Date.parse(health.lastDispatch)>180000)return 'Bot belum dipanggil dalam 3 menit terakhir.';
 const worker=health.worker||{};if(worker.httpStatus===401||worker.httpStatus===403)return 'Pemanggilan bot ditolak. Periksa secret dan autentikasi fungsi.';
 if(worker.timedOut)return 'Pemanggilan bot timeout di server.';
 if(worker.status==='no_recipients')return 'Bot tidak menemukan penerima aktif.';
 if(worker.status==='sources_unavailable'||worker.status==='SNAPSHOT_UNAVAILABLE')return 'Bot tertahan: snapshot atau sumber warning belum siap.';
 if(worker.status==='ACCESS_UNAVAILABLE')return 'Bot tidak dapat membaca pengaturan penerima.';
 if(worker.status==='CONFIG_MISSING')return 'Token WhatsApp atau kunci data bot belum tersedia.';
 if(worker.status==='WARNING_CHECK_FAILED')return 'Proses bot gagal pada tahap '+(worker.stage||'tidak diketahui')+'.';
 if(worker.httpStatus>=400)return 'Endpoint bot gagal (HTTP '+worker.httpStatus+').';
 if(worker.failed>0||health.exhausted>0)return 'Pengiriman ditolak penyedia WhatsApp. Periksa perangkat, token, dan kuota Fonnte.';
 if(worker.uncertain>0)return 'Hasil pengiriman belum pasti; tidak diulang otomatis untuk mencegah pesan ganda.';
 if(worker.accepted>0)return 'Pesan diterima penyedia WhatsApp; penerimaan di perangkat belum terkonfirmasi.';
 if(worker.status==='checked')return 'Bot berjalan; tidak ada pesan baru yang diterima penyedia pada pemeriksaan terakhir.';
 if(worker.status==='busy')return 'Pemeriksaan lain masih berjalan.';
 return 'Pemanggilan tercatat; respons terakhir belum tersedia.';
}
export async function handleNotificationHealth({request,env},{identity=getNoteIdentity,store=workStore}={}){try{if(request.method!=='GET')return json({success:false},405);const actor=await identity(request,env);if(!actor)return json({success:false},401);if(!archiveDeveloperRole(actor.role))return json({success:false},403);const {data}=await store(env,'rpc/warning_notification_health',{method:'POST',body:'{}'});return json({success:true,health:data,message:warningHealthMessage(data)});}catch{return json({success:false,message:'Diagnostik bot belum tersedia. Periksa deployment database notifikasi.'},503);}}
export const onRequest=context=>handleNotificationHealth(context);
