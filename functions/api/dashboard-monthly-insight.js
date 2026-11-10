import { getRequestRole } from './_authz.js';
import { getSecretSupabaseConfig } from './_supabase-config.js';
import { supabaseRows } from './_transaction-read.js';
import {buildMonthlyInsight,monthlyPeriod} from '../../assets/js/utils/monthly-insight.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function readPeriod(config,table,select,period){
 const rows=[];
 for(let offset=0;;offset+=1000){
  const {payload}=await supabaseRows(config,`${table}?select=${select}&tanggal=gte.${period.previousStart}&tanggal=lte.${period.end}&order=tanggal.desc,source_row_number.desc&offset=${offset}&limit=1000`);
  rows.push(...payload);if(payload.length<1000)return rows;
 }
}
// Auto Insight Bulanan shares the same calculations with the hydrated dashboard.
export async function handleDashboardMonthlyInsightRequest({request,env},dependencies={}){
 const started=Date.now();if(!await (dependencies.authorize||getRequestRole)(request,env))return json({success:false,message:'Sesi tidak valid'},401);
 try{
  const config=getSecretSupabaseConfig(env),now=dependencies.now||new Date(),period=monthlyPeriod(now),select='tanggal,sku,nama_barang,qty,status,keterangan,from_location,to_location';
  const [inbound,outbound]=await Promise.all([readPeriod(config,'inventory_barang_masuk',select,period),readPeriod(config,'inventory_barang_keluar',select,period)]);
  return json({success:true,...buildMonthlyInsight({inbound,outbound,now}),metrics:{totalMs:Date.now()-started,returnedRows:inbound.length+outbound.length}});
 }catch(error){console.error('[DashboardMonthlyInsight]',error?.message||error);return json({success:false,message:'Gagal menghitung insight bulanan.'},502);}
}
export const onRequestGet=handleDashboardMonthlyInsightRequest;
