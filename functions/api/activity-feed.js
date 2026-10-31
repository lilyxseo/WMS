import {getNoteIdentity} from './_note-identity.js';
import {archiveDeveloperRole} from '../../assets/js/archive-source-config.js';
import {workStore,json} from './_work-store.js';
export async function handleActivityFeed({request,env},{identity=getNoteIdentity,store=workStore}={}){try{
 if(request.method!=='GET')return json({success:false},405);const actor=await identity(request,env);if(!actor)return json({success:false},401);if(!archiveDeveloperRole(actor.role))return json({success:false},403);
 const q=new URL(request.url).searchParams,limit=Math.min(100,Math.max(1,parseInt(q.get('limit'),10)||25)),offset=Math.max(0,parseInt(q.get('offset'),10)||0),params=new URLSearchParams({select:'*',order:'created_at.desc,id.desc',limit:String(limit),offset:String(offset)});
 for(const field of ['module','action','status','user_id'])if(q.get(field))params.set(field,'eq.'+q.get(field).slice(0,150));if(!q.get('user_id')&&q.get('user_name'))params.set('user_name','ilike.*'+q.get('user_name').replace(/[%_*]/g,'').slice(0,100)+'*');
 const from=q.get('from'),to=q.get('to'),valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if(from&&!valid(from)||to&&!valid(to)||from&&to&&from>to)return json({success:false,message:'Rentang tanggal tidak valid.'},400);
 if(from)params.append('created_at','gte.'+from+'T00:00:00+07:00');if(to)params.append('created_at','lt.'+new Date(Date.parse(to)+86400000).toISOString().slice(0,10)+'T00:00:00+07:00');
 const term=String(q.get('search')||'').replace(/[\\"*,()%_]/g,' ').trim().slice(0,100);if(term)params.set('or','('+['detail','reference','user_name','module','action','role'].map(field=>`${field}.ilike."*${term}*"`).join(',')+')');
 const {data,response}=await store(env,'wms_activity_feed?'+params,{headers:{Prefer:'count=exact'}}),count=response.headers.get('content-range')?.split('/')[1];return json({success:true,data,total:count&&count!=='*'?Number(count):null,limit,offset});
}catch{return json({success:false,message:'Semua aktivitas belum dapat dimuat. Periksa deployment database riwayat aktivitas.'},503);}}
export const onRequest=context=>handleActivityFeed(context);
