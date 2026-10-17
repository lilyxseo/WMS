import {getNoteIdentity} from './_note-identity.js';
import {getSecretSupabaseConfig} from './_supabase-config.js';
import {getGoogleAccessToken} from './_google-auth.js';
import {buildInventorySearchQuery} from './_inventory-search.js';
import {MAX_ENTRY_ROWS,STATUSES,PICS,defaultPic,validateEntries,normalize,selectLedgerSheets,firstEmptyLedgerRow,buildLedgerRequests,quoteSheet} from './_stock-entry.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
async function db(env,path,options={}){
 const config=getSecretSupabaseConfig(env),response=await fetch(`${config.url}/rest/v1/${path}`,{...options,headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,'Content-Type':'application/json',Prefer:'return=representation',...options.headers},signal:AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>null);if(!response.ok||!Array.isArray(data))throw new Error('Database pencatatan transaksi belum tersedia.');return data;
}
async function identity(request,env){const who=await getNoteIdentity(request,env);if(!who)return null;return who;}
const canWrite=who=>/pic/i.test(who.role)||/^(developer|mode development)$/i.test(who.role)||who.id.startsWith('developer:');
async function google(token,sheet,path,options={}){
 const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheet)}${path}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(40000)});
 const data=await response.json().catch(()=>null);return {response,data};
}
async function readGoogle(token,sheet,path){const out=await google(token,sheet,path);if(!out.response.ok||!out.data)throw new Error('Google Sheets belum dapat dibaca. Periksa koneksi atau akses Gmail.');return out.data;}
const jobPath=id=>`stock_entry_batches?id=eq.${id}`;
async function finish(env,id,run,status,result=null){return db(env,jobPath(id)+`&run=eq.${run}`,{method:'PATCH',body:JSON.stringify({status,result,updated_at:new Date().toISOString()})});}
async function recover(env,job){
 if(job.status==='preparing'&&Date.now()-Date.parse(job.updated_at)>180000){const released=await db(env,jobPath(job.id)+`&run=eq.${job.run}&status=eq.preparing`,{method:'PATCH',body:JSON.stringify({status:'failed',updated_at:new Date().toISOString()})});if(released.length)job={...job,status:'failed'};}
 if(job.status==='saved')return json({success:true,id:job.id,result:job.result,replayed:true});
 if(!['writing','uncertain'].includes(job.status))return json({success:false,id:job.id,status:job.status,retryable:job.status==='failed',message:job.status==='preparing'?'Transaksi sedang disiapkan. Periksa status beberapa saat lagi.':'Belum ada transaksi ditulis; input dapat dicoba kembali.'},409);
 const token=await getGoogleAccessToken(env),sheet=String(env.SHEET_ID_2026||'').trim();
 return reconcileReceipt(env,job,token,sheet);
}
async function reconcileReceipt(env,job,token,sheet){
 const {response,data}=await google(token,sheet,'/developerMetadata:search',{method:'POST',body:JSON.stringify({dataFilters:[{developerMetadataLookup:{metadataKey:`wms_input_${job.id}`,visibility:'DOCUMENT'}}]})});
 if(!response.ok||!data)throw new Error('Status penyimpanan belum dapat diperiksa.');
 for(const match of data.matchedDeveloperMetadata||[]){
  let receipt;try{receipt=JSON.parse(match.developerMetadata.metadataValue);}catch{continue;}
  if(receipt.hash===job.payload_hash){await finish(env,job.id,job.run,'saved',receipt.result);return json({success:true,id:job.id,result:receipt.result,replayed:true});}
 }
 return json({success:false,id:job.id,status:job.status,retryable:false,message:'Penyimpanan belum terkonfirmasi. Periksa Barang Masuk/Keluar sebelum membuat transaksi baru.'},409);
}
export async function onRequestGet({request,env}){
 try{
  const who=await identity(request,env);if(!who)return json({success:false,message:'Silakan login kembali.'},401);
  const url=new URL(request.url),id=url.searchParams.get('id');
  if(id){if(!uuid(id))return json({success:false,message:'ID tidak valid.'},400);const jobs=await db(env,jobPath(id)+`&owner=eq.${encodeURIComponent(who.id)}&limit=1`);if(!jobs.length)return json({success:false,status:'not_found',retryable:true,message:'Transaksi belum diterima; input dapat dicoba kembali.'},404);return await recover(env,jobs[0]);}
  if(url.searchParams.has('skus')){
   let skus;try{skus=JSON.parse(url.searchParams.get('skus'));}catch{return json({success:false,message:'SKU tidak valid.'},400);}
   if(!Array.isArray(skus)||!skus.length||skus.length>100||skus.some(sku=>typeof sku!=='string'||!sku.trim()||sku.length>150))return json({success:false,message:'Maksimal 100 SKU valid.'},400);
   const master=[];
   for(let index=0;index<skus.length;index+=25){
    const group=[...new Set(skus.slice(index,index+25))].map(sku=>'"'+sku.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',');
    for(let offset=0;;offset+=1000){const batch=await db(env,'inventory_kartu_stok?'+new URLSearchParams({select:'sku,nama_barang',sku:`in.(${group})`,order:'sku.asc,source_row_number.asc',limit:'1000',offset:String(offset)}));master.push(...batch);if(batch.length<1000)break;}
   }
   return json({success:true,items:master.map(item=>({sku:item.sku,namaBarang:item.nama_barang}))});
  }
  const q=String(url.searchParams.get('q')||'').trim();
  if(q){
   if(q.length<2||q.length>150)return json({success:false,message:'Pencarian 2–150 karakter.'},400);
   const rows=await db(env,'inventory_kartu_stok?select=sku,nama_barang,lokasi_bulky,stok_akhir'+buildInventorySearchQuery(q,['sku','nama_barang'])+'&order=sku.asc&limit=200');
   const grouped=new Map();for(const row of rows){const key=normalize(row.sku);if(!key)continue;const item=grouped.get(key)||{sku:row.sku,namaBarang:row.nama_barang,locations:[]};if(row.lokasi_bulky&&!item.locations.some(l=>l.name===row.lokasi_bulky))item.locations.push({name:row.lokasi_bulky,qty:row.stok_akhir});grouped.set(key,item);}return json({success:true,items:[...grouped.values()].slice(0,20)});
  }
  return json({success:true,statuses:STATUSES,pics:PICS,pic:defaultPic(who.role),canWrite:canWrite(who),defaults:{from:'',to:''},maxRows:MAX_ENTRY_ROWS});
 }catch{return json({success:false,message:'Form input belum dapat dimuat. Coba kembali nanti.'},503);}
}
export async function onRequestPost({request,env}){
 let id,run,writing=false,owned=false;
 try{
  const who=await identity(request,env);if(!who)return json({success:false,message:'Silakan login kembali.'},401);if(!canWrite(who))return json({success:false,message:'Hanya PIC atau Developer yang dapat menyimpan transaksi.'},403);
  let input;try{input=await request.json();}catch{return json({success:false,message:'Data input tidak valid.'},400);}
  id=input?.id;if(!uuid(id))return json({success:false,message:'ID transaksi tidak valid.'},400);
  let entries;try{entries=validateEntries(input.entries);}catch(error){return json({success:false,message:error.message,retryable:true},400);}
  const sheet=String(env.SHEET_ID_2026||'').trim();if(!sheet)return json({success:false,message:'SHEET_ID_2026 belum dikonfigurasi.',retryable:true},503);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(entries))))].map(n=>n.toString(16).padStart(2,'0')).join('');run=crypto.randomUUID();
  const inserted=await db(env,'stock_entry_batches?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id,owner:who.id,author_name:who.name,author_role:who.role,payload_hash:hash,run,status:'preparing'})});
  if(!inserted.length){
   const [job]=await db(env,jobPath(id)+`&owner=eq.${encodeURIComponent(who.id)}&limit=1`);
   if(!job||job.payload_hash!==hash)return json({success:false,message:'ID transaksi sudah digunakan dengan input berbeda.',retryable:false},409);
   if(job.status==='failed'||job.status==='preparing'&&Date.now()-Date.parse(job.updated_at)>180000){
    const retry=await db(env,jobPath(id)+`&run=eq.${job.run}&status=eq.${job.status}`,{method:'PATCH',body:JSON.stringify({run,status:'preparing',updated_at:new Date().toISOString()})});if(!retry.length)return json({success:false,message:'Transaksi sedang diproses.',retryable:false},409);
   }else return await recover(env,job);
  }
  owned=true;
  // Verify names against the authoritative stock card. A stale or edited display
  // name must never silently write a different product to the ledger.
  const skus=[...new Set(entries.map(row=>row.sku))],master=[];
  for(let index=0;index<skus.length;index+=25){
   const group=skus.slice(index,index+25).map(sku=>'"'+sku.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',');
   for(let offset=0;;offset+=1000){const batch=await db(env,'inventory_kartu_stok?'+new URLSearchParams({select:'sku,nama_barang',sku:`in.(${group})`,order:'sku.asc,source_row_number.asc',limit:'1000',offset:String(offset)}));master.push(...batch);if(batch.length<1000)break;}
  }
  for(const row of entries)if(!master.some(item=>item.sku===row.sku&&normalize(item.nama_barang)===normalize(row.namaBarang)))throw new Error(`SKU/nama barang ${row.sku} tidak sesuai Kartu Stok. Pilih ulang barang.`);
  const token=await getGoogleAccessToken(env);
  const metadata=await readGoogle(token,sheet,'?fields=sheets.properties');
  const ledgers=selectLedgerSheets(metadata.sheets||[],entries),requests=[],results=[];
  for(const [status,properties] of Object.entries(ledgers)){
   const selected=entries.filter(row=>row.status===status),available=Number(properties.gridProperties?.columnCount)||16;
   if(available<9)throw new Error(`Tab ${status} harus memiliki minimal 9 kolom A:I.`);
   const columns=String.fromCharCode(64+Math.min(available,status==='Barang Masuk'?15:16));
   const read=await readGoogle(token,sheet,'/values/'+encodeURIComponent(`${quoteSheet(properties.title)}!A:${columns}`));
   const start=firstEmptyLedgerRow(read.values||[]);requests.push(...buildLedgerRequests(properties,start,selected));results.push({status,count:selected.length,sheet:properties.title});
  }
  const result={count:entries.length,qty:entries.reduce((sum,row)=>sum+row.qty,0),ledgers:results};
  requests.push({createDeveloperMetadata:{developerMetadata:{metadataKey:`wms_input_${id}`,metadataValue:JSON.stringify({hash,result}),location:{spreadsheet:true},visibility:'DOCUMENT'}}});
  const locked=await db(env,jobPath(id)+`&run=eq.${run}&status=eq.preparing`,{method:'PATCH',body:JSON.stringify({status:'writing',updated_at:new Date().toISOString()})});if(!locked.length)return json({success:false,message:'Transaksi sedang diperiksa. Gunakan Periksa status.',retryable:false},409);
  writing=true;
  const {response,data}=await google(token,sheet,':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
  if(!response.ok){
   if(response.status>=400&&response.status<500&&data?.error){writing=false;throw new Error('Google Sheets menolak penyimpanan. Periksa akses Editor, proteksi tab, dan konfigurasi sheet.');}
   throw new Error('Penyimpanan Google Sheets belum terkonfirmasi.');
  }
  await finish(env,id,run,'saved',result);return json({success:true,id,result});
 }catch(error){
  if(owned&&id&&run)await finish(env,id,run,writing?'uncertain':'failed').catch(()=>{});
  return json({success:false,id,retryable:!writing,message:writing?'Penyimpanan belum terkonfirmasi. Gunakan Periksa status; jangan membuat transaksi baru.':error?.message||'Transaksi belum disimpan. Coba lagi.'},503);
 }
}
