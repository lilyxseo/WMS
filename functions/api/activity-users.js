import {getNoteIdentity} from './_note-identity.js';
import {archiveDeveloperRole} from '../../assets/js/archive-source-config.js';
import {workStore,json} from './_work-store.js';
export async function onRequestGet({request,env}){try{
 const who=await getNoteIdentity(request,env);if(!who)return json({success:false},401);if(!archiveDeveloperRole(who.role))return json({success:false},403);
 const users=[];for(let offset=0;;offset+=1000){const {data}=await workStore(env,'users?'+new URLSearchParams({select:'id,full_name,username',order:'id.asc',offset:String(offset),limit:'1000'}));if(!Array.isArray(data))throw Error();users.push(...data.map(row=>({id:row.id,name:String(row.full_name||row.username||'User'),username:String(row.username||'')})));if(data.length<1000)break;}
 return json({success:true,users});
}catch{return json({success:false,message:'Daftar user belum dapat dimuat.'},503);}}
