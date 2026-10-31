import {getNoteIdentity} from './_note-identity.js';
import {workStore,json} from './_work-store.js';
import {diagnosticData,diagnosticText,diagnosticPath} from '../../assets/js/diagnostic-data.js';
const actions=new Set(['CLIENT_ERROR','UI_ACTION','API_REQUEST','PAGE_VIEW','LOGIN','AUTO_LOGIN']);
export async function handleClientEvents({request,env},{identity=getNoteIdentity,store=workStore}={}){try{
 if(request.method!=='POST')return json({success:false},405);
 const who=await identity(request,env);if(!who)return json({success:false},401);
 if(Number(request.headers.get('content-length'))>64000)return json({success:false},413);
 const reader=request.body?.getReader();if(!reader)return json({success:false},400);let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64000){await reader.cancel();return json({success:false},413);}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({success:false},400);}
 if(!Array.isArray(body.events)||!body.events.length||body.events.length>20)return json({success:false},400);
 const rows=[];for(const event of body.events){if(!actions.has(event?.action)||!/^[-\w]{8,100}$/.test(event?.id||''))return json({success:false},400);
 const metadata=diagnosticData(event.metadata||{}),page=diagnosticPath(event.page||'/');rows.push({user_id:who.id.startsWith('developer:')?'developer':who.id,user_name:who.name,role:who.role,action:event.action,module:['LOGIN','AUTO_LOGIN'].includes(event.action)?'Auth':event.action==='CLIENT_ERROR'?'Browser':page,detail:diagnosticText(event.detail,1000),reference:event.id,status:event.status==='FAILED'||event.action==='CLIENT_ERROR'?'FAILED':'SUCCESS',metadata:{...metadata,page,source:'CLIENT_TELEMETRY',verified:false,occurredAt:diagnosticText(event.timestamp,40)}});}
 const refs=rows.map(row=>row.reference);const {data:existing}=await store(env,'activity_logs?'+new URLSearchParams({select:'reference',reference:'in.('+refs.join(',')+')'}));const known=new Set((existing||[]).map(row=>row.reference)),unique=[...new Map(rows.filter(row=>!known.has(row.reference)).map(row=>[row.reference,row])).values()];
 if(unique.length)await store(env,'activity_logs',{method:'POST',body:JSON.stringify(unique),headers:{Prefer:'return=minimal'}});
 return json({success:true,stored:unique.length},201);
}catch{return json({success:false,message:'Pencatatan diagnostik belum tersedia.'},503);}}
export const onRequest=context=>handleClientEvents(context);
