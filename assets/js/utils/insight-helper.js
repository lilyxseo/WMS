import {buildMonthlyInsight} from './monthly-insight.js';
// Use the same period, transaction classifications and ranking as the API.
export function buildAutoInsight(data,{now=new Date()}={}){
 return buildMonthlyInsight({inbound:data?.['Barang Masuk']||[],outbound:data?.['Barang Keluar']||[],now}).insight;
}
