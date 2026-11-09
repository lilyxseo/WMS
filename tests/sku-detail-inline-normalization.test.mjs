import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as inbound} from '../functions/api/barang-masuk/bulk-update.js';
import {onRequestPost as outbound} from '../functions/api/barang-keluar/bulk-update.js';
import {parseBarangMasukValues} from '../functions/api/sync/inventory/_barang-masuk-service.js';
import {parseBarangKeluarValues} from '../functions/api/sync/inventory/_barang-keluar-service.js';
import {mapBarangMasukRow} from '../functions/api/barang-masuk/index.js';
import {mapBarangKeluarRow} from '../functions/api/barang-keluar/index.js';
const env={PREVIEW_BYPASS_LOGIN:'true',SHEET_ID_2026:'ledger',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
const base=['TANGGAL','FROM','TO','SKU','NAMA BARANG','QTY','STATUS','PIC','KETERANGAN','NO ISELLER','NETSUITE','KETERANGAN LAINNYA'];
async function scenario(kind,{change=null,rawSku='682200004386',fields=['qty','pic']}={}){
 const incoming=kind==='in',headers=incoming?[...base,'LOKASI SURAT JALAN','STOCKOUT','DOKUMEN']:[...base.map(h=>h==='NAMA BARANG'?'NAMABARANG':h),'STATUS','LOKASI SURAT JALAN','NO ISELLER AWAL','DOKUMEN'];
 const raw=['10/30/2026',' f18–1 ',' 10001-bt-tng-pslama ',rawSku,'TR TUMBLER KACA 450ML','1,000','Barang Keluar','EPRIL\u200b','PENGELUARAN'];
 const parsed=await (incoming?parseBarangMasukValues:parseBarangKeluarValues)([headers,raw]);assert.equal(parsed.rows.length,1);
 const snapshot=(incoming?mapBarangMasukRow:mapBarangKeluarRow)(parsed.rows[0]);
 const expected={sku:snapshot.sku,cells:{tanggal:snapshot.tanggal,from:snapshot.from,to:snapshot.to,...Object.fromEntries(fields.map(field=>[field,snapshot[field]]))}};
 const current=[...raw];if(change)current[change.column]=change.value;
 const writes=[],original=globalThis.fetch;
 globalThis.fetch=async(url,init={})=>{if(url.includes('app-google-auth'))return Response.json({access_token:'test'});if(url.includes('/values:batchUpdate')){writes.push(JSON.parse(init.body));return Response.json({totalUpdatedCells:fields.length});}return Response.json({values:[current]});};
 try{const response=await (incoming?inbound:outbound)({env,request:new Request('https://app.test/api/'+(incoming?'barang-masuk':'barang-keluar')+'/bulk-update',{method:'POST',headers:{'x-preview-bypass-login':'true','Content-Type':'application/json'},body:JSON.stringify({rowNumbers:[2],updates:Object.fromEntries(fields.map(field=>[field,field==='qty'?1001:'AZRIN'])),expectedRows:{2:expected}})})});return {response,body:await response.json(),writes};}finally{globalThis.fetch=original;}
}
for(const kind of ['in','out']){
 test(`${kind}: normalized Detail SKU snapshot can edit two cells against unchanged Google row`,async()=>{const result=await scenario(kind);assert.equal(result.response.status,200,JSON.stringify(result.body));assert.equal(result.writes.length,1);assert.equal(result.writes[0].data.length,2);});
 test(`${kind}: SKU normalization preserves invisible characters and smart-dash equivalence`,async()=>{const result=await scenario(kind,{rawSku:'0012–AB\u200b'});assert.equal(result.response.status,200,JSON.stringify(result.body));assert.equal(result.writes.length,1);});
 test(`${kind}: real source changes and shifted SKU still block writes`,async()=>{
  for(const change of [{column:1,value:'F19-1'},{column:2,value:'OTHER SHOP'},{column:3,value:'OTHER SKU'},{column:5,value:999},{column:7,value:'ANOTHER PIC'},{column:0,value:'10/29/2026'}]){
   const result=await scenario(kind,{change});assert.notEqual(result.response.status,200);assert.equal(result.writes.length,0);
  }
 });
 test(`${kind}: leading zeros remain part of the SKU identity`,async()=>{const result=await scenario(kind,{rawSku:'0012',change:{column:3,value:'12'}});assert.notEqual(result.response.status,200);assert.equal(result.writes.length,0);});
}
