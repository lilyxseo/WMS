import test from 'node:test';import assert from 'node:assert/strict';import {outboundFromWarnings} from '../functions/api/_inventory-warnings.js';import {observableWarnings,fingerprint} from '../supabase/functions/warning-whatsapp/handler.js';
const sample={sku:'682500000817',nama_barang:'TR WALL CLOCK TYPE 777 POLOS COKLAT',qty:20,from_location:'C16-2, D12-2',to_location:'10010-BT-TGR-Kelapa Dua',tanggal:'2026-10-30',source_row_number:50,reason:'multiple'};
test('combined From locations in the supplied case are high-priority warnings with SKU, quantity and source row',()=>{const [warning]=outboundFromWarnings([sample]);assert.equal(warning.category,'INVALID_OUTBOUND_FROM');assert.equal(warning.severity,'High');assert.equal(warning.sku,sample.sku);assert.equal(warning.sourceRow,50);assert.equal(warning.location,sample.from_location);assert.match(warning.issue,/20/);assert.match(warning.recommendation,/Pisahkan transaksi/);});
test('missing From is invalid but unknown special locations require historical verification',()=>{const rows=outboundFromWarnings([{...sample,from_location:'',reason:'empty'},{...sample,from_location:'RUANG TR 2',reason:'unknown'},{...sample,qty:0}]);assert.equal(rows.length,2);assert.equal(rows[0].severity,'High');assert.equal(rows[1].confidence,'review');assert.equal(rows[1].severity,'Medium');assert.match(rows[1].recommendation,/historis/);});
test('new From warnings require fresh outbound proof, and unknown locations require verified location data too',()=>{const [combined]=outboundFromWarnings([sample]),[unknown]=outboundFromWarnings([{...sample,reason:'unknown'}]),snapshot={snapshotStale:false,rows:[combined,unknown],verification:[{source:'barang_keluar',ready:true}]};assert.equal(observableWarnings(snapshot).length,1);assert.equal(observableWarnings({...snapshot,verification:[...snapshot.verification,{source:'kartu_stok',ready:true}]}).length,2);assert.notEqual(fingerprint(combined),fingerprint({...combined,transactionTo:'OTHER'}));});

test('missing SKU + From inbound evidence is a review warning with complete transaction details',async()=>{
 const {outboundLocationWarnings}=await import('../functions/api/_inventory-warnings.js');
 const [warning]=outboundLocationWarnings([{...sample,reason:'missing_inbound',from_location:'A01-1'}]);
 assert.equal(warning.category,'OUTBOUND_LOCATION_WITHOUT_INBOUND');assert.equal(warning.confidence,'review');assert.equal(warning.severity,'Medium');assert.equal(warning.sourceRow,50);
 for(const value of [sample.tanggal,'50','A01-1',sample.to_location,'20'])assert.ok(warning.evidence.includes(value));
 assert.match(warning.recommendation,/Perlu verifikasi/);assert.match(warning.recommendation,/saldo awal/);assert.match(warning.recommendation,/tidak lengkap/);
 assert.equal(outboundFromWarnings([{...sample,reason:'missing_inbound'}]).length,0);
 assert.equal(outboundLocationWarnings([{...sample,reason:'unknown'},{...sample,reason:'missing_inbound',qty:0}]).length,0);
});

test('location absence is suppressed until inbound evidence is verified in the atomic snapshot',async()=>{
 const {loadInventoryWarnings}=await import('../functions/api/_inventory-warnings.js');const original=globalThis.fetch;
 const sources=['kartu_stok','rpl','bulky','barang_masuk','barang_keluar'],version='a'.repeat(64),now=new Date().toISOString();
 const input={stocks:{kartuStok:[],rpl:[],bulky:[]},sync:sources.map(source=>({source,status:'success',last_success_at:now,source_version:version})),signatures:sources.map(source=>({source,content_version:version,row_count:0})),ledgerAvailable:true,ledger:[],movementAvailable:false,outboundFromAvailable:true,outboundFrom:[{...sample,reason:'missing_inbound'}]};
 globalThis.fetch=async()=>Response.json(input);
 try{
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',WMS_WARNING_ATOMIC_READ:'true'};
  let data=await loadInventoryWarnings(env,{full:true});assert.equal(data.rows.filter(row=>row.category==='OUTBOUND_LOCATION_WITHOUT_INBOUND').length,1);
  input.signatures=input.signatures.filter(row=>row.source!=='barang_masuk');data=await loadInventoryWarnings(env,{full:true});assert.equal(data.rows.filter(row=>row.category==='OUTBOUND_LOCATION_WITHOUT_INBOUND').length,0);assert.equal(data.checks.find(row=>row.key==='outbound-location-inbound').ready,false);
 }finally{globalThis.fetch=original;}
});
