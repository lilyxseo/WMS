import {cellImagesConfigured,loadCatalogCellImages,catalogName} from './_catalog-cell-images.js';
import {getNoteIdentity} from './_note-identity.js';
import {getGoogleAccessToken} from './_google-auth.js';
import {json} from './_work-store.js';
import {CATALOG_ID,CATALOG_TABS,parseCatalog} from './_catalog.js';
let snapshotCache;
async function readCatalogRows(env,dependencies,{force=false}={}){
 const now=Date.now();if(!force&&!dependencies.fetchFn&&snapshotCache?.expires>now)return snapshotCache.promise;
 const promise=(async()=>{
  const fetchFn=dependencies.fetchFn||fetch,token=await (dependencies.getToken||getGoogleAccessToken)(env);
  const read=async path=>{const response=await fetchFn('https://sheets.googleapis.com/v4/spreadsheets/'+CATALOG_ID+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});if(!response.ok){if([403,404].includes(response.status))throw Error('Katalog belum dapat diakses. Bagikan spreadsheet KATALOG UPDATE ke akun Gmail WMS.');throw Error('Katalog gagal dimuat dari Google Sheets. Coba Refresh.');}return response.json();};
  const metadata=await read('?fields=sheets.properties(sheetId,title)');
  const tabs=CATALOG_TABS.map(tab=>{const sheet=metadata.sheets?.find(sheet=>sheet.properties?.sheetId===tab.id);if(!sheet)throw Error('Tab '+tab.title+' tidak ditemukan di KATALOG UPDATE.');return {...tab,title:sheet.properties.title};});
  const params=new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'}),formulas=new URLSearchParams({valueRenderOption:'FORMULA'});for(const tab of tabs){const prefix="'"+tab.title.replaceAll("'","''")+"'!";params.append('ranges',prefix+(tab.key==='main'?'A1:K':'A1:C'));formulas.append('ranges',prefix+'A1:C');}
  const [data,formulaData]=await Promise.all([read('/values:batchGet?'+params),read('/values:batchGet?'+formulas)]);
  if(data.valueRanges?.length!==tabs.length||formulaData.valueRanges?.length!==tabs.length)throw Error('Data kedua tab katalog belum lengkap. Coba Refresh.');
  return {products:tabs.flatMap((tab,i)=>parseCatalog(data.valueRanges[i].values||[],tab,formulaData.valueRanges[i].values||[])),sources:tabs.map(({key,label,title})=>({key,label,title})),updatedAt:new Date().toISOString()};
 })();if(!dependencies.fetchFn)snapshotCache={promise,expires:now+60000};try{return await promise;}catch(error){if(snapshotCache?.promise===promise)snapshotCache=null;throw error;}
}
const normalized=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function catalogPageOptions(request){const params=new URL(request.url).searchParams,query=String(params.get('q')||'').trim().slice(0,200),sku=String(params.get('sku')||'').trim().slice(0,100),source=params.get('source')||'all',image=params.get('image')||'all',page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||24);if(!['all','main','supplement'].includes(source)||!['all','yes','no'].includes(image)||!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>48)throw Error('Filter katalog tidak valid.');return {query,sku,source,image,page,pageSize,force:params.get('refresh')==='1'};}
export async function handleCatalog({request,env},dependencies={}){
 try{
  if(!await (dependencies.identity||getNoteIdentity)(request,env))return json({success:false,message:'Silakan login kembali.'},401);
  if(request.method!=='GET')return json({success:false,message:'Metode tidak tersedia.'},405);
  let options;try{options=catalogPageOptions(request);}catch(error){return json({success:false,message:error.message},400);}
  const snapshot=await readCatalogRows(env,dependencies,options),words=normalized(options.query).split(' ').filter(Boolean);
  let candidates=snapshot.products.filter(item=>(options.source==='all'||item.source===options.source)&&(!options.sku||normalized(item.sku)===normalized(options.sku))&&words.every(word=>normalized([item.sku,item.name,item.parent,item.variant].join(' ')).includes(word))),imageWarning='';
  const enrich=async rows=>{
   if(!rows.some(item=>item.source==='supplement'&&!item.imageUrl))return rows;
   if(!cellImagesConfigured(env)){imageWarning='Gambar dalam sel belum terhubung ke pembaca Apps Script.';return rows;}
   try{const manifest=await (dependencies.cellImages||loadCatalogCellImages)(env,{fetchFn:dependencies.fetchFn||fetch});return rows.map(item=>{const image=manifest.images.get(item.sourceRow);return item.source==='supplement'&&!item.imageUrl&&image&&catalogName(item.name)===catalogName(image.name)?{...item,imageUrl:'/api/catalog-image?source=supplement&row='+item.sourceRow+'&v='+manifest.version}:item;});}
   catch(error){imageWarning=error.message||'Gambar sel belum dapat dimuat.';return rows;}
  };
  if(options.image!=='all'){candidates=(await enrich(candidates)).filter(item=>(options.image==='yes')===!!item.imageUrl);}
  const total=candidates.length,page=Math.min(options.page,Math.max(1,Math.ceil(total/options.pageSize))),start=(page-1)*options.pageSize;
  const products=options.image==='all'?await enrich(candidates.slice(start,start+options.pageSize)):candidates.slice(start,start+options.pageSize);
  return json({success:true,imageWarning,products,total,totalProducts:snapshot.products.length,page,pageSize:options.pageSize,hasNext:start+products.length<total,sources:snapshot.sources,updatedAt:snapshot.updatedAt});
 }catch(error){return json({success:false,message:error.message||'Katalog belum dapat dimuat.'},503);}
}
export const onRequest=context=>handleCatalog(context);
