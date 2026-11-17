import test from 'node:test';import assert from 'node:assert/strict';
import {handleAssetRead} from '../functions/api/asset-store/index.js';
const context=sheet=>({request:new Request('https://wms.test/api/asset-store'+(sheet===undefined?'':'?'+new URLSearchParams({sheet}))),env:{}});
test('Section options come from sheet dropdown rules including referenced ranges',async()=>{
 for(const type of ['ONE_OF_LIST','ONE_OF_RANGE']){
  const calls=[],result=await handleAssetRead(context('Asset A'),{identity:async()=>({id:'staff'}),getToken:async()=>'token',fetchFn:async input=>{
   const url=decodeURIComponent(input);calls.push(url);
   if(url.includes('/values/Options'))return Response.json({values:[['Gudang'],['Store'],['Store']]});
   if(url.includes('/values/'))return Response.json({values:[['Date','Section'],['2026-11-17','Old']]});
   if(url.includes('ranges='))return Response.json({sheets:[{data:[{rowData:[{values:[{dataValidation:{condition:{type,values:type==='ONE_OF_LIST'?[{userEnteredValue:'Gudang'},{userEnteredValue:'Store'}]:[{userEnteredValue:'=Options!A2:A'}]}}}]}]}]}]});
   return Response.json({sheets:[{properties:{title:'Asset A'}}]});
  }});
  const data=await result.json();assert.equal(result.status,200);assert.deepEqual(data.sectionOptions,['Gudang','Store']);
  assert.ok(calls.some(url=>url.includes('dataValidation')));
 }
});
test('Asset reads require a verified user and use server OAuth for metadata and quoted ranges',async()=>{const calls=[],dependencies={identity:async()=>({id:'staff'}),getToken:async()=> 'private-token',fetchFn:async(url,options)=>{calls.push(url);assert.equal(options.headers.Authorization,'Bearer private-token');assert.ok(!url.includes('key='));return Response.json(url.includes('/values/')?{values:[['SKU'],['123']]}:{sheets:[{properties:{title:"Asset O'Brien"}},{properties:{title:'Other'}}]});}};const list=await(await handleAssetRead(context(),dependencies)).json();assert.equal(list.sheets.length,1);assert.doesNotMatch(JSON.stringify(list),/private-token/);const result=await(await handleAssetRead(context("Asset O'Brien"),dependencies)).json();assert.deepEqual(result.values,[['SKU'],['123']]);assert.match(decodeURIComponent(calls.at(-1)),/'Asset O''Brien'!A1:ZZ/);let touched=false;assert.equal((await handleAssetRead(context(),{identity:async()=>null,getToken:async()=>{touched=true;}})).status,401);assert.equal(touched,false);});
test('unknown/non-Asset sheets are rejected and Google access failures are not disguised as empty data',async()=>{const deps={identity:async()=>({id:'staff'}),getToken:async()=> 'token',fetchFn:async()=>Response.json({sheets:[{properties:{title:'Asset A'}}]})};assert.equal((await handleAssetRead(context('Other'),deps)).status,400);assert.equal((await handleAssetRead(context('Asset Unknown'),deps)).status,404);const response=await handleAssetRead(context(),{...deps,fetchFn:async()=>Response.json({error:{message:'private Google detail'}},{status:403})});assert.equal(response.status,503);const body=await response.json();assert.equal(body.success,false);assert.match(body.message,/Gmail WMS/);assert.doesNotMatch(body.message,/private Google detail/);});
