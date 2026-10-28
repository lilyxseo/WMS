import test from 'node:test';import assert from 'node:assert/strict';import {stockTotals,handleDashboardStockTotals} from '../functions/api/dashboard-stock-totals.js';
test('active SKUs use their net Kartu Stok balance across locations, preserving zeros and negatives',()=>{assert.deepEqual(stockTotals([{sku:' a ',stok_akhir:5},{sku:'A',stok_akhir:-5},{sku:'B',stok_akhir:8},{sku:'B',stok_akhir:2},{sku:'C',stok_akhir:-3},{sku:'D',stok_akhir:0},{sku:'',stok_akhir:99}]),{activeSku:1,totalQty:7});});

test('dashboard stock totals include all pages and deny anonymous access',async()=>{
 const context={request:new Request('https://wms.test/api/dashboard-stock-totals'),env:{SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'sb_secret_test'}};
 assert.equal((await handleDashboardStockTotals(context,{authorize:async()=>false})).status,401);
 const offsets=[];const response=await handleDashboardStockTotals(context,{authorize:async()=>true,fetch:async url=>{const offset=Number(new URL(url).searchParams.get('offset'));offsets.push(offset);return Response.json(offset===0?Array.from({length:1000},()=>({sku:'A',stok_akhir:1})):[{sku:'A',stok_akhir:-1000},{sku:'B',stok_akhir:2}]);}});
 assert.deepEqual(offsets,[0,1000]);assert.deepEqual(await response.json(),{success:true,activeSku:1,totalQty:2});
});
