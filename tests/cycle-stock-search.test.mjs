import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createMovementStockSearch} from '../assets/js/movement-stock-search.js';
import {onRequestGet} from '../functions/api/cycle-count/search.js';
const source=await readFile(new URL('../assets/js/main.js',import.meta.url),'utf8');
const tick=()=>new Promise(setImmediate);
test('Cycle Count numeric SKU uses its server route immediately; stale/cleared queries never select old stock',async()=>{
 const calls=[],search=createMovementStockSearch({endpoint:'/api/cycle-count/search',delay:5000,fetchFn:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))});
 search.search('0012');assert.equal(calls.length,1);assert.match(calls[0].url,/^\/api\/cycle-count\/search\?q=0012$/);search.search('0013');calls[1].resolve(Response.json({success:true,rows:[{sku:'0013',lokasi:'B',stok_akhir:-3}]}));await tick();calls[0].resolve(Response.json({success:true,rows:[{sku:'0012',lokasi:'A',stok_akhir:8}]}));await tick();assert.equal(search.state.rows[0].sku,'0013');search.search('');assert.equal(search.state.rows.length,0);search.dispose();
});
test('Cycle Count server preserves exact SKU text, negative nonzero balances and selected locations',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);globalThis.fetch=async url=>{assert.match(url,/sku=eq.0012/);return Response.json([{sku:'0012',nama_barang:'Product',lokasi_bulky:'B',stok_akhir:-3},{sku:'0012',nama_barang:'Product',lokasi_bulky:'C',stok_akhir:0}]);};
 const response=await onRequestGet({request:new Request('https://test/api/cycle-count/search?q=0012',{headers:{'x-preview-bypass-login':'true'}}),env:{PREVIEW_BYPASS_LOGIN:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'}});const data=await response.json();assert.equal(data.rows.length,1);assert.deepEqual(data.rows[0],{sku:'0012',nama:'Product',lokasi:'B',stok_akhir:-3});
 const ctx=vm.createContext({window:{},CYCLE_STATE:{sessionItems:[],submitting:false},cycleStockSearch:{state:{rows:data.rows}},getQty:row=>row.stok_akhir,clean:String,cycleItemKey:row=>row.sku+'|'+row.lokasi,renderCycleSessionTable(){},toast(){}});
 const line=prefix=>source.split('\n').find(line=>line.startsWith(prefix));vm.runInContext(line('function getCycleSourceRows()')+'\n'+line('function addCycleItem(')+'\n'+line('window.ccAddItem='),ctx);ctx.window.ccAddItem('0012','B');assert.equal(ctx.CYCLE_STATE.sessionItems[0].sku,'0012');assert.equal(ctx.CYCLE_STATE.sessionItems[0].lokasi,'B');assert.equal(ctx.CYCLE_STATE.sessionItems[0].stok,-3);ctx.window.ccAddItem('12','B');assert.equal(ctx.CYCLE_STATE.sessionItems.length,1);
});
test('Movement and Cycle Count page initialization only loads their history and never hydrates the full stock card',async()=>{
 const code=source.slice(source.indexOf('async function loadDetailPageData('),source.indexOf('async function initAppData('));let histories=0;const ctx=vm.createContext({ensureCycleHistoryLoaded:async()=>histories++,ensureMovementHistoryLoaded:async()=>histories++});vm.runInContext(code,ctx);await ctx.loadDetailPageData('cycle-count');await ctx.loadDetailPageData('movement');assert.equal(histories,2);
});
