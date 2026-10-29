import {getAccessToken,escSheet} from './_utils.js';
import {getRequestRole} from '../_authz.js';
import {parseBalikanSheet} from './_parse-sheet.js';
import {fetchLocationInventory} from './_location-inventory.js';
import {fetchLastInboundLocations} from './_last-inbound-location.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function handleAllTrips({request,env},dependencies={}){
 if(!await (dependencies.authorize||getRequestRole)(request,env))return json({message:'Sesi tidak valid'},401);
 try{
  const sheets=JSON.parse(new URL(request.url).searchParams.get('sheets')||'[]');
  if(!Array.isArray(sheets)||!sheets.length||sheets.length>150||sheets.some(name=>typeof name!=='string'||name.length>100||!name.toUpperCase().includes('TRIP'))||new Set(sheets).size!==sheets.length)return json({message:'Daftar sheet TRIP tidak valid'},400);
  const token=await (dependencies.getToken||getAccessToken)(env),fetchFn=dependencies.fetch||fetch,results=new Map(),failures=[];let cursor=0;
  const read=async names=>{
   try{const params=new URLSearchParams();names.forEach(name=>params.append('ranges',escSheet(name)+'!A1:ZZ'));
    const response=await fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_INVENTORY}/values:batchGet?${params}`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)}),data=await response.json();
    if(!response.ok){if(response.status===400&&names.length>1){for(const name of names)await read([name]);return;}throw Error('Gagal membaca sheet TRIP');}
    if(!Array.isArray(data.valueRanges)||data.valueRanges.length!==names.length)throw Error('Respons sheet belum lengkap');
    names.forEach((name,index)=>{try{results.set(name,{sheetName:name,...parseBalikanSheet(data.valueRanges[index].values||[])});}catch{failures.push({sheet:name});}});
   }catch{names.forEach(sheet=>failures.push({sheet}));}
  };
  async function worker(){while(cursor<sheets.length){const start=cursor;cursor+=8;await read(sheets.slice(start,start+8));}}
  await Promise.all([worker(),worker()]);
  if(!results.size)return json({message:'Semua sheet TRIP gagal dimuat'},502);
  const ordered=sheets.map(name=>results.get(name)).filter(Boolean),skus=[...new Set(ordered.flatMap(sheet=>sheet.rows.map(row=>row.sku)))];
  const [inventory,inbound]=await Promise.allSettled([(dependencies.inventory||fetchLocationInventory)(env,skus),(dependencies.inbound||fetchLastInboundLocations)(env,skus)]);
  ordered.forEach(sheet=>sheet.rows.forEach(row=>{const sku=String(row.sku||'').trim().toLowerCase();row.locations=inventory.status==='fulfilled'?inventory.value[sku]||[]:[];row.lastInboundLocation=inbound.status==='fulfilled'?inbound.value[sku]||'':'';}));
  return json({sheets:ordered,failures,locationInventoryError:inventory.status==='rejected',lastInboundLocationError:inbound.status==='rejected'});
 }catch{return json({message:'Gagal memuat semua TRIP'},502);}
}
export const onRequestGet=context=>handleAllTrips(context);
