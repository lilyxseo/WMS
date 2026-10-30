import {loadCatalogEmbedded} from './_catalog-embedded.js';
import {getNoteIdentity} from './_note-identity.js';
import {getGoogleAccessToken} from './_google-auth.js';
import {json} from './_work-store.js';
import {CATALOG_ID,CATALOG_TABS,parseCatalog} from './_catalog.js';
export async function handleCatalog({request,env},dependencies={}){
 try{
  const actor=await (dependencies.identity||getNoteIdentity)(request,env);if(!actor)return json({success:false,message:'Silakan login kembali.'},401);
  if(request.method!=='GET')return json({success:false,message:'Metode tidak tersedia.'},405);
  const fetchFn=dependencies.fetchFn||fetch,token=await (dependencies.getToken||getGoogleAccessToken)(env);
  const read=async path=>{const response=await fetchFn('https://sheets.googleapis.com/v4/spreadsheets/'+CATALOG_ID+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});if(!response.ok){if([403,404].includes(response.status))throw Error('Katalog belum dapat diakses. Bagikan spreadsheet KATALOG UPDATE ke akun Gmail WMS.');throw Error('Katalog gagal dimuat dari Google Sheets. Coba Refresh.');}return response.json();};
  const metadata=await read('?fields=sheets.properties(sheetId,title)');
  const tabs=CATALOG_TABS.map(tab=>{const sheet=metadata.sheets?.find(sheet=>sheet.properties?.sheetId===tab.id);if(!sheet)throw Error('Tab '+tab.title+' tidak ditemukan di KATALOG UPDATE.');return {...tab,title:sheet.properties.title};});
  const params=new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'});for(const tab of tabs)params.append('ranges',"'"+tab.title.replaceAll("'","''")+"'!A1:Z");
  const formulas=new URLSearchParams(params);formulas.set('valueRenderOption','FORMULA');
  // Keep displayed names/SKUs while reading IMAGE URLs from their formulas.
  const [data,formulaData]=await Promise.all([read('/values:batchGet?'+params),read('/values:batchGet?'+formulas)]);
  if(data.valueRanges?.length!==tabs.length||formulaData.valueRanges?.length!==tabs.length)throw Error('Data kedua tab katalog belum lengkap. Coba Refresh.');
  const products=tabs.flatMap((tab,i)=>parseCatalog(data.valueRanges[i].values||[],tab,formulaData.valueRanges[i].values||[]));
  let imageWarning='';
  if(products.some(item=>!item.imageUrl))try{const workbook=await (dependencies.embedded||loadCatalogEmbedded)(env,{fetchFn,getToken:async()=>token});for(const item of products)if(!item.imageUrl&&workbook.images.has(item.source+':'+item.sourceRow))item.imageUrl='/api/catalog-image?source='+item.source+'&row='+item.sourceRow+'&v='+workbook.version;if(products.some(item=>item.source==='supplement'&&!item.imageUrl))imageWarning='Sebagian gambar dalam sel belum tersedia dari ekspor spreadsheet.';}catch{imageWarning='Sebagian gambar belum dapat dimuat. Coba Refresh.';}
  return json({success:true,imageWarning,products,sources:tabs.map(({key,label,title})=>({key,label,title})),updatedAt:new Date().toISOString()});
 }catch(error){return json({success:false,message:error.message||'Katalog belum dapat dimuat.'},503);}
}
export const onRequest=context=>handleCatalog(context);
