import {getNoteIdentity} from '../_note-identity.js';
import {workStore} from '../_work-store.js';
export const validBatchId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const path=(id,owner)=>'stock_entry_batches?'+new URLSearchParams({id:'eq.'+id,owner:'eq.'+owner});
export async function deliveryIdentity(request,env){return getNoteIdentity(request,env);}
export async function readDelivery(env,id,owner){const {data}=await workStore(env,path(id,owner)+'&limit=1');return data[0];}
export function deliveryResult(job){
 if(job.status==='saved')return {success:true,id:job.id,...job.result,replayed:true};
 return {success:false,id:job.id,status:job.status,writeState:job.status==='failed'?'not_started':'uncertain',retryable:job.status==='failed',destinations:job.result?.destinations||{},message:job.status==='failed'?'Belum ada data ditulis. Batch yang sama dapat dicoba kembali.':'Batch belum terkonfirmasi lengkap. Jangan kirim ulang; periksa kedua spreadsheet.'};
}
export async function claimDelivery(env,id,who,items){
 const payload_hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({kind:'movement',items}))))].map(n=>n.toString(16).padStart(2,'0')).join(''),run=crypto.randomUUID();
 const {data}=await workStore(env,'stock_entry_batches?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id,owner:who.id,author_name:who.name,author_role:who.role,payload_hash,run,status:'preparing',result:{kind:'movement'}})});
 if(data.length)return {id,owner:who.id,run,payload_hash};
 const job=await readDelivery(env,id,who.id);
 if(!job||job.payload_hash!==payload_hash)throw Error('ID batch sudah digunakan oleh transaksi berbeda.');
 if(job.status==='failed'){
  const {data:claimed}=await workStore(env,path(id,who.id)+'&run=eq.'+job.run+'&status=eq.failed',{method:'PATCH',body:JSON.stringify({run,status:'preparing',updated_at:new Date().toISOString()})});
  if(claimed.length)return {id,owner:who.id,run,payload_hash};
 }
 return {response:deliveryResult(job)};
}
export async function checkpointDelivery(env,job,status,result){
 const {data}=await workStore(env,path(job.id,job.owner)+'&run=eq.'+job.run,{method:'PATCH',body:JSON.stringify({status,result:{kind:'movement',...result},updated_at:new Date().toISOString()})});
 if(data.length!==1)throw Error('Status batch belum dapat dikonfirmasi.');
}

async function google(accessToken,sheetId,path,options={}){
 const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}${path}`,{...options,headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});
 return {res,data:await res.json().catch(()=>({}))};
}
const text=value=>String(value??'').trim();
export function firstEmptyMovementRow(values,destination){
 const normalized=value=>text(value).toUpperCase().replace(/[\s_]+/g,'');
 const header=values.slice(0,10).findIndex(row=>normalized(row?.[3])==='SKU'&&['NAMA','NAMABARANG'].includes(normalized(row?.[4]))&&['TANGGAL','FROM','TO'].every((name,index)=>normalized(row?.[index])===name));
 if(header<0)throw Error('Header Movement/Barang Masuk tidak sesuai. Tidak ada baris ditulis.');
 // Status/PIC defaults and stock formulas must not push entries below the template.
 const businessColumns=destination==='inventory'?5:6;
 let index=header+1;
 while(index<values.length&&(values[index]||[]).slice(0,businessColumns).some(value=>text(value)!==''))index++;
 return index;
}
export function buildMovementWriteRequests({sheet,start,values,job,destination,businessDate}){
 const receipt={kind:'movement',hash:job.payload_hash,destination,processed:values.length,businessDate};
 const dateSerial=Date.parse(businessDate+'T00:00:00Z')/86400000+25569;
 const cells=row=>row.map((value,index)=>index===0?{userEnteredValue:{numberValue:dateSerial},userEnteredFormat:{numberFormat:{type:'DATE',pattern:destination==='inventory'?'yyyy-mm-dd':'m/d/yyyy'}}}:{userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:String(value??'')}});
 const rowCount=Number(sheet.gridProperties?.rowCount)||0,extra=Math.max(0,start+values.length-rowCount);
 return [
  ...(extra?[{appendDimension:{sheetId:sheet.sheetId,dimension:'ROWS',length:extra}}]:[]),
  // Inserting and filling in one atomic batch prevents two writers overwriting
  // each other even when both observed the same empty business row.
  {insertDimension:{range:{sheetId:sheet.sheetId,dimension:'ROWS',startIndex:start,endIndex:start+values.length},inheritFromBefore:false}},
  {updateCells:{start:{sheetId:sheet.sheetId,rowIndex:start,columnIndex:0},rows:values.map(row=>({values:cells(row)})),fields:'userEnteredValue,userEnteredFormat.numberFormat'}},
  {createDeveloperMetadata:{developerMetadata:{metadataKey:'wms_movement_'+job.id,metadataValue:JSON.stringify(receipt),location:{spreadsheet:true},visibility:'DOCUMENT'}}}
 ];
}
export async function writeDeliverySheet({accessToken,sheetId,title,values,job,destination,businessDate}){
 const metadata=await google(accessToken,sheetId,'?fields=sheets.properties');if(!metadata.res.ok)return metadata;
 const sheet=metadata.data.sheets?.find(sheet=>sheet.properties?.title===title)?.properties;
 if(!sheet)return {res:new Response(null,{status:404}),data:{error:{message:`Tab ${title} tidak ditemukan.`}}};
 const range="'"+title.replaceAll("'","''")+"'!A:"+(destination==='inventory'?'E':'F');
 const source=await google(accessToken,sheetId,'/values/'+encodeURIComponent(range));if(!source.res.ok)return source;
 const start=firstEmptyMovementRow(source.data.values||[],destination);
 return google(accessToken,sheetId,':batchUpdate',{method:'POST',body:JSON.stringify({requests:buildMovementWriteRequests({sheet,start,values,job,destination,businessDate})})});
}
export async function readDeliveryReceipt(accessToken,sheetId,job,destination){
 const {res,data}=await google(accessToken,sheetId,'/developerMetadata:search',{method:'POST',body:JSON.stringify({dataFilters:[{developerMetadataLookup:{metadataKey:'wms_movement_'+job.id,visibility:'DOCUMENT'}}]})});
 if(!res.ok)throw Error('Bukti pengiriman belum dapat diperiksa.');
 for(const match of data.matchedDeveloperMetadata||[]){try{const receipt=JSON.parse(match.developerMetadata.metadataValue);if(receipt.kind==='movement'&&receipt.hash===job.payload_hash&&receipt.destination===destination)return receipt;}catch{}}
 return null;
}
