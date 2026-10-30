const normalized=value=>String(value??'').normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
const numeric=value=>value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
const equal=(a,b)=>Math.abs(a-b)<0.000001;
export function attachNegativeStockTraces(warnings,contexts,{ready=false}={}){
 if(!ready)return warnings;
 const index=new Map((contexts||[]).map(context=>[JSON.stringify([normalized(context.sku),normalized(context.location),Number(context.stockRow)]),context]));
 return warnings.map(warning=>{if(warning.category!=='NEGATIVE_STOCK')return warning;const context=index.get(JSON.stringify([normalized(warning.sku),normalized(warning.location),Number(warning.sourceRow)]));if(!context)return warning;
  const transactions=(context.transactions||[]).filter(row=>numeric(row.qty)>0&&normalized(row.sku)===normalized(warning.sku)&&normalized(row.from)===normalized(warning.location)).sort((a,b)=>String(a.eventDate||'').localeCompare(String(b.eventDate||''))||Number(a.row)-Number(b.row));
  const opening=numeric(context.opening),closing=numeric(context.closing),outgoing=numeric(context.outgoing),transfer=numeric(context.transfer),replenishment=numeric(context.replenishment),sum=transactions.reduce((total,row)=>total+Number(row.qty),0);
  const reconciled=context.stockRows===1&&context.total===transactions.length&&!context.unknownDates&&!context.laterIncoming&&transactions.length>0&&transactions.every(row=>row.source==='Barang Keluar'&&/^\d{4}-\d{2}-\d{2}$/.test(row.eventDate||''))&&[opening,closing,outgoing,transfer,replenishment].every(value=>value!==null)&&transfer===0&&replenishment===0&&equal(opening-outgoing,closing)&&equal(sum,outgoing);
  let balance=opening,primary=null;
  if(reconciled)for(const transaction of transactions){const before=balance;balance-=Number(transaction.qty);if(!primary&&before>=0&&balance<0)primary={...transaction,before,after:balance};}
  const confirmed=!!primary;if(!primary)primary=transactions.at(-1)||null;
  const latest=transactions.slice(-10).reverse();if(primary&&!latest.some(row=>row.source===primary.source&&row.row===primary.row))latest.unshift(primary);
  return {...warning,deductionTrace:{confirmed,primary,transactions:latest,total:context.total||0,note:confirmed?'Saldo melewati nol berdasarkan riwayat yang cocok dengan saldo dan total pengeluaran.':'Pemotongan terkait. Penyebab pasti belum dapat ditetapkan karena saldo, urutan, atau kelengkapan riwayat belum dapat direkonsiliasi.'}};
 });
}
