import {cellImagesConfigured,loadCatalogCellImages,readCatalogCellImage} from './_catalog-cell-images.js';
import {getNoteIdentity} from './_note-identity.js';
import {json} from './_work-store.js';
export async function handleCatalogImage({request,env},dependencies={}){try{
 if(!await (dependencies.identity||getNoteIdentity)(request,env))return json({success:false},401);
 if(request.method!=='GET')return json({success:false},405);
 const params=new URL(request.url).searchParams,source=params.get('source'),row=params.get('row');if(!['main','supplement'].includes(source)||!/^\d{1,7}$/.test(row||'')||Number(row)<1)return json({success:false},400);
 if(source==='supplement'&&cellImagesConfigured(env)){const manifest=await (dependencies.cellImages||loadCatalogCellImages)(env),image=manifest.images.get(Number(row));if(!image)return json({success:false},404);const {body,type}=await (dependencies.readCellImage||readCatalogCellImage)(image.url,{env});return new Response(body,{headers:{'Content-Type':type,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});}
 return json({success:false,message:'Gambar dalam sel belum terhubung ke pembaca Apps Script.'},source==='supplement'?503:404);
}catch{return json({success:false,message:'Gambar belum dapat dimuat.'},503);}}
export const onRequest=context=>handleCatalogImage(context);
