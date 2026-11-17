import test from 'node:test';
import assert from 'node:assert/strict';
import {transactionPage} from '../functions/api/_transaction-read.js';

test('transaction reads overlap bounded batches and cache a correctly sorted window for subsequent pages',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 let calls=0,running=0,peak=0;
 const rows=Array.from({length:4200},(_,index)=>({source_row_number:index+2,sku:'00'+index,qty:1,tanggal:index%2?'2026-11-17':'11/16/2026'}));
 globalThis.fetch=async input=>{
  calls++;running++;peak=Math.max(peak,running);
  const url=new URL(input),offset=Number(url.searchParams.get('offset'));
  await new Promise(resolve=>setTimeout(resolve,2));running--;
  return Response.json([...rows].reverse().slice(offset,offset+1000),{headers:{'Content-Range':`${offset}-${Math.min(offset+999,4199)}/4200`}});
 };
 const config={url:'https://perf-test.supabase.co',key:'test'},options={limit:25,cacheRead:true,columns:'*'};
 const first=await transactionPage(config,'inventory_barang_masuk',{...options,page:1});
 assert.equal(first.total,4200);assert.equal(first.summary.totalQty,4200);assert.equal(first.rows.length,25);
 assert.ok(first.rows.every(row=>row.tanggal==='2026-11-17'));
 assert.equal(calls,5);assert.ok(peak>1&&peak<=3);
 const second=await transactionPage(config,'inventory_barang_masuk',{...options,page:2});
 assert.equal(calls,5);assert.equal(second.rows.length,25);
 assert.equal(new Set([...first.rows,...second.rows].map(row=>row.source_row_number)).size,50);
 await transactionPage(config,'inventory_barang_masuk',{...options,cacheRefresh:true,page:1});assert.equal(calls,10);
});

test('a failed parallel batch never returns or caches partial transaction data',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 let broken=true;
 globalThis.fetch=async input=>{
  const offset=Number(new URL(input).searchParams.get('offset'));
  if(broken&&offset===1000)return Response.json({message:'database unavailable'},{status:503});
  return Response.json(Array.from({length:1000},(_,i)=>({source_row_number:offset+i,sku:'0012',tanggal:'2026-11-17',qty:1})),{headers:{'Content-Range':`${offset}-${offset+999}/3000`}});
 };
 const config={url:'https://perf-failure.supabase.co',key:'test'},options={cacheRead:true,limit:25};
 await assert.rejects(transactionPage(config,'inventory_barang_keluar',options),/database unavailable/);
 broken=false;
 assert.equal((await transactionPage(config,'inventory_barang_keluar',options)).total,3000);
});
