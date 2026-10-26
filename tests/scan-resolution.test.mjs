import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeScanValue} from '../assets/js/utils/scan-value.js';
import {handleBarcodeLookupRequest} from '../functions/api/barcode-lookup.js';
const main=fs.readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
const env={SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'sb_secret_test',PREVIEW_BYPASS_LOGIN:'true'};
const request=value=>new Request('https://wms.test/api/barcode-lookup?barcode='+encodeURIComponent(value),{headers:{'x-preview-bypass-login':'true'}});
test('scan normalization preserves complete alphanumeric SKUs, zeroes and recognized QR wrappers',()=>{
 for(const [input,output] of [['GT-682200001520-BL','GT-682200001520-BL'],[' 0000123456789\r\n','0000123456789'],[']C1GT-LRRK-B','GT-LRRK-B'],['SKU: GT-LRRK-B','GT-LRRK-B'],['https://gotoliving.app/sku/GT-LRRK-B','GT-LRRK-B'],['https://gotoliving.app/item?sku=GT-LRRK-B','GT-LRRK-B'],['{"sku":"000123"}','000123']])assert.equal(normalizeScanValue(input),output);
});
test('direct SKU lookup is exact, preserves leading zeroes and accepts canonical letter SKUs',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const calls=[];
 globalThis.fetch=async input=>{const url=new URL(input);calls.push(url);return Response.json(url.pathname.endsWith('inventory_kartu_stok')&&url.searchParams.get('sku')==='eq.GT-682200001520-BL'?[{sku:'GT-682200001520-BL'}]:url.pathname.endsWith('inventory_rpl')&&url.searchParams.get('sku')==='eq.000123'?[{sku:'000123'}]:[]);};
 for(const sku of ['GT-682200001520-BL','000123','gt-682200001520-bl']){const response=await handleBarcodeLookupRequest({request:request(sku),env});assert.equal(response.status,200);assert.equal((await response.json()).sku,sku.toUpperCase());}
 assert.ok(calls.some(url=>url.searchParams.get('sku')==='eq.000123'));assert.ok(!calls.some(url=>url.searchParams.get('sku')==='eq.123'));
});
test('ambiguous product barcode refuses to choose an arbitrary SKU',async t=>{const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);globalThis.fetch=async()=>Response.json([{sku:'A'},{sku:'B'}]);const response=await handleBarcodeLookupRequest({request:request('8991234567890'),env});assert.equal(response.status,409);assert.equal((await response.json()).error,'BARCODE_AMBIGUOUS');});
test('a confirmed exact SKU remains usable when another inventory source fails',async t=>{const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);globalThis.fetch=async input=>{const url=new URL(input);if(url.pathname.endsWith('inventory_kartu_stok'))return Response.json([{sku:'GT-LRRK-B'}]);if(url.pathname.endsWith('inventory_rpl'))return Response.json({error:'Unavailable'},{status:503});return Response.json([]);};const response=await handleBarcodeLookupRequest({request:request('GT-LRRK-B'),env});assert.equal(response.status,200);assert.equal((await response.json()).sku,'GT-LRRK-B');});
test('shared frontend resolver uses authenticated canonical mapping and exact TRIP-only SKUs',async()=>{
 let payload={success:true,found:true,sku:'GT-LRRK-B'},requested;const context=vm.createContext({normalizeScanValue,getAuthHeaders:async()=>({Authorization:'Bearer verified'}),AbortSignal,window:{BALIKAN_ROWS:[{sku:'TRIP-ONLY'}]},nativeFetch:async(url,options)=>{requested={url,options};return Response.json(payload);}});
 vm.runInContext(main.slice(main.indexOf('function cleanScannedSku'),main.indexOf('function triggerSearchSku')),context);
 assert.equal((await context.resolveScannedSku('8991234567890')).sku,'GT-LRRK-B');assert.equal(requested.options.headers.Authorization,'Bearer verified');payload={success:true,found:false};assert.equal((await context.resolveScannedSku('TRIP-ONLY')).mapped,true);assert.equal((await context.resolveScannedSku('UNKNOWN')).mapped,false);await context.resolveScannedSku('GT-682200001520-BL');assert.ok(requested.url.endsWith('GT-682200001520-BL'));
});
test('search scan opens the mapped SKU, never the raw product barcode',async()=>{
 const visits=[],input={};const context=vm.createContext({resolveScannedSku:async()=>({scanned:'8991234567890',sku:'GT-LRRK-B',mapped:true}),normalizeScannedSku:normalizeScanValue,SCANNER_STATE:{lastSearchSku:'',lastSearchNavigationAt:0},SEARCH_SCAN_NAVIGATION_LOCK_MS:750,document:{getElementById:()=>input},navigateTo:url=>visits.push(url),currentUserIdentity:()=>({}),logActivity:async()=>{},toast(){}});
 vm.runInContext(main.slice(main.indexOf('async function handleSearchScanResult'),main.indexOf('async function openBarcodeScanner')),context);await context.handleSearchScanResult('8991234567890');assert.deepEqual(visits,['/sku/GT-LRRK-B']);assert.equal(input.value,'GT-LRRK-B');await context.handleSearchScanResult('8991234567890');assert.equal(visits.length,1);
});
test('scanner constructor receives symbologies including Code39 and broad one-dimensional framing',()=>{
 const supported={QR_CODE:0,CODE_128:1,CODE_39:2,CODE_93:3,ITF:4,EAN_13:5};const context=vm.createContext({window:{Html5QrcodeSupportedFormats:supported}});vm.runInContext(main.slice(main.indexOf('function getScannerConfig'),main.indexOf('function playScanSuccessFeedback')),context);const config=context.getScannerConfig();assert.ok(config.formatsToSupport.includes(supported.CODE_39));assert.ok(config.formatsToSupport.includes(supported.ITF));const box=config.qrbox(400,300);assert.equal(box.width,360);assert.ok(box.height<box.width);assert.match(main,/new window.Html5Qrcode\(readerId,\{formatsToSupport:config.formatsToSupport/);assert.match(main,/experimentalFeatures:\{useBarCodeDetectorIfSupported:false\}/);
});

test('Movement scanner searches the canonical SKU returned by the shared resolver',async()=>{
 let renders=0;const input={};const state={};const context=vm.createContext({resolveScannedSku:async()=>({scanned:'8991234567890',sku:'GT-LRRK-B',mapped:true}),MOVEMENT_STATE:state,document:{getElementById:()=>input},renderMovementSearchResults:()=>renders++,showToast(){},console});
 vm.runInContext(main.slice(main.indexOf('async function handleMovementScanSearchResult'),main.indexOf('function openMovementScanner')),context);await context.handleMovementScanSearchResult('8991234567890');assert.equal(state.search,'GT-LRRK-B');assert.equal(input.value,'GT-LRRK-B');assert.equal(renders,1);
});
test('Balikan scanner finds and checks only the exact resolved SKU row',async()=>{
 const checked=[],input={},row={sku:'GT-LRRK-B',rowNumber:12};const context=vm.createContext({navigator:{},resolveScannedSku:async()=>({scanned:'8991234567890',sku:'GT-LRRK-B',mapped:true}),window:{BALIKAN_ROWS:[row],setTimeout(){}},BALIKAN_STATE:{autoCheckOnScan:true},document:{querySelector:()=>input},saveBalikanSearchHistory(){},getBalikanActiveSheetName:()=> 'TRIP 7',renderBalikanTable(){},toggleBalikanCheck:async(...args)=>checked.push(args),showToast(){},toast(){},setTimeout(){},console});
 vm.runInContext(main.slice(main.indexOf('async function handleBalikanScanResult'),main.indexOf('\n',main.indexOf('async function handleBalikanScanResult'))),context);await context.handleBalikanScanResult('8991234567890');assert.equal(input.value,'GT-LRRK-B');assert.deepEqual(checked,[['TRIP 7',12,true]]);
});
test('closing the scanner during camera startup releases the late camera without processing its result',async()=>{
 let start,stops=0,clears=0,processed=0;const modal={hidden:true},state={generation:0,isScannerRunning:false,isClosing:false,hasScanned:false,resultHandler:()=>processed++};
 class Scanner{start(_camera,_config,callback){this.callback=callback;return new Promise(resolve=>start=resolve);}async stop(){stops++;}clear(){clears++;}}
 const context=vm.createContext({window:{Html5Qrcode:Scanner},SCANNER_STATE:state,ensureScannerLibrary:async()=>{},navigator:{mediaDevices:{getUserMedia(){}}},document:{getElementById:()=>modal,body:{classList:{add(){},remove(){}}}},getScannerConfig:()=>({formatsToSupport:[0,1]}),toast(){},playScanSuccessFeedback(){},console,setTimeout(){}});
 vm.runInContext(main.slice(main.indexOf('async function openScannerModal'),main.indexOf('function pickQuickResult')),context);const opening=context.openScannerModal();await new Promise(resolve=>setImmediate(resolve));const instance=state.instance;await context.closeScannerModal();start();await opening;await instance.callback('GT-LRRK-B');assert.equal(processed,0);assert.equal(modal.hidden,true);assert.ok(stops>=1);assert.ok(clears>=1);
});
