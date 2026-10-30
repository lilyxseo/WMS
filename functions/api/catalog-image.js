import {getNoteIdentity} from './_note-identity.js';
import {getGoogleAccessToken} from './_google-auth.js';
import {json} from './_work-store.js';
import {loadCatalogEmbedded,catalogRaster} from './_catalog-embedded.js';
export async function handleCatalogImage({request,env},dependencies={}){try{
 if(!await (dependencies.identity||getNoteIdentity)(request,env))return json({success:false},401);
 if(request.method!=='GET')return json({success:false},405);
 const params=new URL(request.url).searchParams,source=params.get('source'),row=params.get('row');if(!['main','supplement'].includes(source)||!/^\d{1,7}$/.test(row||'')||Number(row)<1)return json({success:false},400);
 const workbook=await (dependencies.load||loadCatalogEmbedded)(env,{getToken:getGoogleAccessToken}),path=workbook.images.get(source+':'+Number(row));if(!path)return json({success:false},404);
 const bytes=await workbook.read(path),type=bytes&&catalogRaster(bytes);if(!type)return json({success:false},415);
 return new Response(bytes,{headers:{'Content-Type':type,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});
}catch{return json({success:false,message:'Gambar belum dapat dimuat.'},503);}}
export const onRequest=context=>handleCatalogImage(context);
