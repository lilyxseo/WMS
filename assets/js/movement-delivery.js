// Immutable batch journal. A response only updates its batch, never the active form.
export function createMovementDelivery({owner,storage=localStorage,fetchFn=fetch,beforeSend=async()=>{},onChange=()=>{},isCurrent=()=>true,uuid=()=>crypto.randomUUID()}){
 const key='wms:movement-delivery:v1:'+encodeURIComponent(owner),running=new Set();let batches=[];
 try{const saved=JSON.parse(storage.getItem(key)||'[]');if(!Array.isArray(saved))throw Error();batches=saved.map(batch=>({...batch,status:batch.status==='sending'?'uncertain':batch.status}));}catch(error){if(storage.getItem(key))throw Error('Jurnal pengiriman tidak dapat dibaca. Jangan kirim sebelum dipulihkan.');}
 const clone=value=>JSON.parse(JSON.stringify(value));
 function persist(){storage.setItem(key,JSON.stringify(batches));if(isCurrent())onChange();}
 function update(id,patch){const batch=batches.find(item=>item.id===id);if(!batch)return;Object.assign(batch,patch);try{persist();}catch{batch.message=(batch.message||'')+' · Salinan perangkat belum diperbarui; periksa status server setelah memuat ulang.';if(isCurrent())onChange();}}
 function merge(remote=[]){let changed=false;for(const batch of remote){if(!batch?.id||!Array.isArray(batch.items)||batches.some(item=>item.id===batch.id))continue;batches.push({...clone(batch),status:batch.status==='sending'?'uncertain':batch.status});changed=true;}if(changed)persist();}
 function enqueue(items,id=uuid()){
  if(batches.some(batch=>batch.id===id))throw Error('Batch sudah masuk antrean.');
  // An unresolved identical snapshot must be reconciled, not assigned a new ID.
  const signature=rows=>JSON.stringify(rows.map(item=>Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)))));
  const fingerprint=signature(items);
  if(batches.some(batch=>['sending','uncertain','failed'].includes(batch.status)&&signature(batch.items)===fingerprint))throw Error('Batch identik belum selesai. Periksa status atau coba kembali batch sebelumnya.');
  const batch={id,items:clone(items),status:'sending',createdAt:new Date().toISOString(),message:'Menunggu pengiriman',destinations:{}};
  batches.push(batch);try{persist();}catch(error){batches.pop();throw error;}return id;
 }
 async function send(id){
  const batch=batches.find(item=>item.id===id);if(!batch||running.has(id)||!['sending','failed'].includes(batch.status))return;
  running.add(id);let started=false;
  try{
   update(id,{status:'sending',message:'Sedang dikirim'});await beforeSend();if(!isCurrent())throw Error('Sesi berubah; batch belum dikirim.');
   started=true;const response=await fetchFn('/api/movement/in',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,items:batch.items}),signal:AbortSignal.timeout(60000)}),data=await response.json();
   const complete=response.ok&&data.success===true&&data.destinations?.inventory==='saved'&&data.destinations?.barangMasuk==='saved';
   update(id,{status:complete?'saved':(data.writeState==='not_started'||data.dataNotSent===true)?'failed':'uncertain',destinations:data.destinations||{},message:complete?'Berhasil disimpan di kedua spreadsheet':data.message||'Belum terkonfirmasi lengkap'});
  }catch(error){update(id,{status:started?'uncertain':'failed',message:error.message||'Koneksi terputus. Periksa status sebelum mengirim ulang.'});}
  finally{running.delete(id);}
 }
 async function check(id){
  if(running.has(id))return;const batch=batches.find(item=>item.id===id);if(!batch||batch.status==='saved')return;
  try{const response=await fetchFn('/api/movement/in?id='+encodeURIComponent(id),{cache:'no-store',signal:AbortSignal.timeout(20000)}),data=await response.json();
   const complete=response.ok&&data.success===true&&data.destinations?.inventory==='saved'&&data.destinations?.barangMasuk==='saved';
   update(id,{status:complete?'saved':data.writeState==='not_started'&&data.retryable===true?'failed':'uncertain',destinations:data.destinations||{},message:data.message||(complete?'Berhasil disimpan di kedua spreadsheet':'Belum terkonfirmasi lengkap')});
  }catch{update(id,{status:'uncertain',message:'Pemeriksaan gagal. Jangan kirim ulang sebelum hasil terkonfirmasi.'});}
 }
 return {enqueue,send,check,merge,get batches(){return clone(batches);}};
}
