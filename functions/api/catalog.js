import {cellImagesConfigured,loadCatalogCellImages,catalogName} from './_catalog-cell-images.js';
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
  const params=new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'}),formulas=new URLSearchParams({valueRenderOption:'FORMULA'});for(const tab of tabs){const prefix="'"+tab.title.replaceAll("'","''")+"'!";params.append('ranges',prefix+(tab.key==='main'?'A1:K':'A1:C'));formulas.append('ranges',prefix+'A1:C');}
  // Keep displayed names/SKUs while reading IMAGE URLs from their formulas.
  const [data,formulaData]=await Promise.all([read('/values:batchGet?'+params),read('/values:batchGet?'+formulas)]);
  if(data.valueRanges?.length!==tabs.length||formulaData.valueRanges?.length!==tabs.length)throw Error('Data kedua tab katalog belum lengkap. Coba Refresh.');
  const products=tabs.flatMap((tab,i)=>parseCatalog(data.valueRanges[i].values||[],tab,formulaData.valueRanges[i].values||[]));
  let imageWarning='';
  if(cellImagesConfigured(env)){
   try{const manifest=await (dependencies.cellImages||loadCatalogCellImages)(env,{fetchFn});for(const item of products){const image=manifest.images.get(item.sourceRow);if(item.source==='supplement'&&!item.imageUrl&&image&&catalogName(item.name)===catalogName(image.name))item.imageUrl='/api/catalog-image?source=supplement&row='+item.sourceRow+'&v='+manifest.version;}if(products.some(item=>item.source==='supplement'&&!item.imageUrl))imageWarning='Sebagian produk belum memiliki gambar sel yang dapat dibaca.';}
   catch(error){imageWarning=error.message||'Gambar sel belum dapat dimuat.';}
  }else if(products.some(item=>item.source==='supplement'&&!item.imageUrl)){imageWarning='Gambar dalam sel belum terhubung ke pembaca Apps Script.';}
  return json({success:true,imageWarning,products,sources:tabs.map(({key,label,title})=>({key,label,title})),updatedAt:new Date().toISOString()});
 }catch(error){return json({success:false,message:error.message||'Katalog belum dapat dimuat.'},503);}
}
export const onRequest=context=>handleCatalog(context);
