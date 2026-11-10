import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {onRequestGet} from '../functions/api/movement.js';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
const env={PREVIEW_BYPASS_LOGIN:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SHEET_ID_INVENTORY:'inventory'};
const request=()=>new Request('https://wms.test/api/movement?mode=history',{headers:{'x-preview-bypass-login':'true'}});
test('movement history uses an authenticated server request, not a browser API key',async()=>{
 const fn=source.slice(source.indexOf('async function fetchMovementHistoryRemote'),source.indexOf('async function ensureMovementHistoryLoaded'));const calls=[],values=[['Tanggal','From','To','SKU'],['2026-11-10','A','B','0012']];
 const ctx=vm.createContext({getAuthHeaders:async()=>({Authorization:'Bearer session'}),fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({success:true,values})};},parseMovementHistoryRows:rows=>({rows})});vm.runInContext(fn,ctx);const result=await ctx.fetchMovementHistoryRemote();assert.equal(calls[0].url,'/api/movement?mode=history');assert.equal(calls[0].options.headers.Authorization,'Bearer session');assert.deepEqual(result.rows,values);assert.doesNotMatch(fn,/API_KEY|sheets.googleapis.com/);
});
test('server history reads private Inventory with OAuth and preserves original sheet positions',async()=>{
 const original=globalThis.fetch,calls=[],values=[['Title'],[],['Tanggal','From','To','SKU'],['2026-11-10','A','B','0012']];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(url.includes('app-google-auth')?{access_token:'server-google-token'}:{values});};
 try{const response=await onRequestGet({request:request(),env});assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.values,values);assert.ok(calls[1].url.includes('/spreadsheets/inventory/'));assert.equal(calls[1].options.headers.Authorization,'Bearer server-google-token');assert.ok(!JSON.stringify(body).includes('server-google-token'));}finally{globalThis.fetch=original;}
});
test('history requires a session and source permission errors are not reported as empty success',async()=>{
 assert.equal((await onRequestGet({request:request(),env:{}})).status,401);const original=globalThis.fetch;globalThis.fetch=async url=>url.includes('app-google-auth')?Response.json({access_token:'server-google-token'}):Response.json({error:{message:'The caller does not have permission'}},{status:403});try{const response=await onRequestGet({request:request(),env});const body=await response.json();assert.equal(response.status,403);assert.equal(body.code,'MOVEMENT_SOURCE_PERMISSION_DENIED');assert.match(body.message,/akses baca/);assert.equal(body.success,false);}finally{globalThis.fetch=original;}
});
test('normal draft status cards disappear but conflict, uncertain delivery and save errors stay visible',()=>{
 const state={sessionActive:true,delivery:'editing'},cloud={status:'saved'},map=new Map([['cycle-count',{controller:{state:cloud}}]]);let element={hidden:false,innerHTML:'',classList:{toggle(){}}};
 const code=source.slice(source.indexOf('function showInventoryDraftNotice'),source.indexOf('function persistInventoryDraft'))+'\n'+source.split('\n').find(line=>line.startsWith('function renderInventoryDraftNotice('));
 const ctx=vm.createContext({inventoryDraftState:()=>state,ACCOUNT_INVENTORY_DRAFTS:map,inventoryDraftNoticeContent:()=> 'Warning details',document:{getElementById:()=>element}});vm.runInContext(code,ctx);assert.match(ctx.renderInventoryDraftNotice('cycle-count'),/hidden/);assert.doesNotMatch(ctx.renderInventoryDraftNotice('cycle-count'),/Warning details/);ctx.updateInventoryDraftNotice('cycle-count');assert.equal(element.hidden,true);assert.equal(element.innerHTML,'');
 for(const condition of ['conflict','error']){cloud.status=condition;assert.equal(ctx.showInventoryDraftNotice('cycle-count'),true);}cloud.status='saved';state.delivery='uncertain';assert.equal(ctx.showInventoryDraftNotice('cycle-count'),true);state.delivery='editing';state.draftSaveFailed=true;assert.equal(ctx.showInventoryDraftNotice('cycle-count'),true);
});
