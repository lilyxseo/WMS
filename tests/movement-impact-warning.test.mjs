import test from 'node:test';
import assert from 'node:assert/strict';
import {movementImpactFindings,normalizeMovementLocation} from '../functions/api/_movement-warning.js';
import {normalizeWarningSku,warningNumber,loadInventoryWarnings} from '../functions/api/_inventory-warnings.js';
import {businessDateKey} from '../functions/api/_inventory-analytics.js';
import {fingerprint} from '../supabase/functions/warning-whatsapp/handler.js';
const move=overrides=>({sku:'682200007014',nama_barang:'TR PROKLEEN',qty:10,from_location:'C18-1',to_location:'C01-1',keterangan:'INTERNAL STOCK TRANSFER',status:'Movement',tanggal:'2026-10-09',synced_at:'2026-10-13T04:05:04.256Z',source_row_number:23547,...overrides});
const stock=()=>[{sku:'682200007014',lokasi_bulky:'C18-1',stok_awal:35,stok_akhir:10,internal_stock_transfer:0,replenishment:0,pengeluaran:25,source_row_number:2285},{sku:'682200007014',lokasi_bulky:'C01-1',stok_awal:null,stok_akhir:0,internal_stock_transfer:0,replenishment:0,pengeluaran:0,source_row_number:1735}];
const options={normalizeSku:normalizeWarningSku,number:warningNumber,businessDate:'2026-10-14',stockCheckedAt:'2026-10-14T01:42:00Z',now:'2026-10-14T01:45:00Z'};
const check=(movements=[move()],rows=stock(),activity=[],extra={})=>movementImpactFindings({movements,activity},rows,{...options,...extra});
test('reported 10-piece movement with both transfer fields zero is detected despite a blank destination opening balance',()=>{
 const result=check();assert.equal(result.findings.length,1);const finding=result.findings[0];assert.equal(finding.category,'MOVEMENT_NOT_REFLECTED');assert.equal(finding.confidence,'review');assert.match(finding.issue,/10 pcs.*From C18-1.*To C01-1/);assert.match(finding.evidence,/STOK AWAL kosong/);assert.match(finding.evidence,/23547/);assert.match(finding.recommendation,/jangan input movement ulang/);
});
test('correct outgoing source component and received destination opening do not warn even if closing stock is zero',()=>{const rows=stock();rows[0].internal_stock_transfer=10;rows[0].stok_akhir=0;rows[1].stok_awal=10;rows[1].internal_stock_transfer=0;rows[1].stok_akhir=0;assert.equal(check([move()],rows).findings.length,0);});
test('reversal cancels net impact rather than creating false no-impact warnings',()=>assert.equal(check([move(),move({from_location:'C01-1',to_location:'C18-1',source_row_number:24000,tanggal:'2026-10-10'})]).findings.length,0));
test('partial reversal still leaves a nonzero net that should have a transfer component',()=>{const found=check([move(),move({qty:4,from_location:'C01-1',to_location:'C18-1',source_row_number:24000,tanggal:'2026-10-10'})]).findings;assert.ok(found.length>0);assert.match(found[0].evidence,/netto lokasi 6/);});
test('old-period movements, future dates, missing dates and invalid quantities do not generate impact assertions',()=>{
 for(const changes of [{tanggal:'2025-10-09'},{tanggal:'2026-12-09'},{tanggal:'2026-02-30'},{tanggal:null},{qty:null},{qty:'1,000'},{qty:-1}])assert.equal(check([move(changes)]).findings.length,0);
 assert.equal(check([move(),move({qty:null})]).findings.length,0);
});
test('unknown fields are not converted to zero; partial nonzero transfers do not become speculative quantity discrepancies',()=>{const rows=stock();rows[0].internal_stock_transfer=null;rows[1].stok_awal='bad';rows[1].internal_stock_transfer=null;assert.equal(check([move()],rows).findings.length,0);rows[0].internal_stock_transfer=2;rows[1].stok_awal=2;rows[1].internal_stock_transfer=0;assert.equal(check([move()],rows).findings.length,0);});
test('positive stock counterpart permits a missing SKU/location finding, but a completely absent SKU does not',()=>{let found=check([move()],stock().slice(0,1)).findings;assert.equal(found.length,1);assert.match(found[0].issue,/To C01-1 belum memiliki baris SKU/);assert.equal(check([move()],[]).findings.length,0);});
test('same-day or later transactions suppress ambiguous side assertions and unknown activity dates remain unassessed',()=>{
 const activity=['C18-1','C01-1'].map(location=>({sku:'682200007014',location,last_date:'2026-10-09',unknown_date:false}));assert.equal(check([move()],stock(),activity).findings.length,0);
 activity.forEach(row=>{row.last_date='2026-10-10';});assert.equal(check([move()],stock(),activity).findings.length,0);
 activity.forEach(row=>{row.last_date=null;row.unknown_date=true;});assert.equal(check([move()],stock(),activity).findings.length,0);
 activity.forEach(row=>{row.last_date='2026-05-19';row.unknown_date=false;});assert.equal(check([move()],stock(),activity).findings.length,1);
});
test('two-minute grace and an actual later stock snapshot are required; unchanged stock-row synced_at is ignored',()=>{
 for(const stockCheckedAt of ['2026-10-13T04:05:00Z','2026-10-13T04:06:00Z',null])assert.equal(check([move()],stock(),[],{stockCheckedAt}).findings.length,0);
 assert.equal(check([move()],stock(),[],{now:'2026-10-13T04:06:00Z'}).findings.length,0);
 assert.equal(check([move({synced_at:null})]).findings.length,0);
});
test('location normalization preserves different rack identities and matches whitespace, smart dashes and URI encoding',()=>{assert.equal(normalizeMovementLocation(' c18%E2%80%931\u200b '),'C18-1');assert.notEqual(normalizeMovementLocation('C01-1'),normalizeMovementLocation('C1-1'));const rows=stock();rows[0].lokasi_bulky=' c18–1 ';rows[1].lokasi_bulky='C01%2D1';assert.equal(check([move()],rows).findings.length,1);});
test('same-location and zero-quantity inputs have explicit no-effect warnings',()=>{
 assert.equal(check([move({to_location:' c18–1 '})]).findings[0].category,'MOVEMENT_NO_EFFECT');assert.equal(check([move({qty:0})]).findings[0].category,'MOVEMENT_NO_EFFECT');
});
test('replenishment checks its own component rather than the internal-transfer column',()=>{const rows=stock();rows.forEach(row=>{row.internal_stock_transfer=50;});assert.equal(check([move({keterangan:'REPLENISHMENT'})],rows).findings.length,1);rows[0].replenishment=10;rows[1].replenishment=-10;assert.equal(check([move({keterangan:'REPLENISHMENT'})],rows).findings.length,0);});
test('invisible SKU characters match, but leading-zero identifiers never merge',()=>{const rows=stock();rows.forEach(row=>row.sku=' ６８２２００００７０１４\u200b ');assert.equal(check([move()],rows).findings.length,1);rows.forEach(row=>row.sku='0682200007014');assert.equal(check([move()],rows).findings.length,0);});
function mock(t,{changed=false,unavailable=false}={}){
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let read=0;
 globalThis.fetch=async input=>{const url=String(input);
  if(url.includes('inventory_sync_status')){read++;return Response.json(['kartu_stok','rpl','bulky','barang_masuk','barang_keluar'].map(source=>({source,status:'success',locked_at:null,last_success_at:new Date(Date.now()-5*60000).toISOString(),source_version:changed&&read===2&&source==='barang_masuk'?'v2':'v1'})));}
  if(url.includes('inventory_warning_movement_context'))return unavailable?Response.json({},{status:503}):Response.json({movements:[move({tanggal:businessDateKey(),synced_at:new Date(Date.now()-10*60000).toISOString()})],activity:[]});
  if(url.includes('/rpc/'))return Response.json([]);
  return Response.json(url.includes('inventory_kartu_stok')?stock():[]);
 };
}
test('movement warnings integrate with global categories, filters and WhatsApp deduplication',async t=>{mock(t);const result=await loadInventoryWarnings({SUPABASE_URL:'https://project.test',SUPABASE_SECRET_KEY:'sb_secret_test'},{category:'MOVEMENT_NOT_REFLECTED'});assert.equal(result.partial,false);assert.equal(result.rows.length,1);const found=result.rows[0];assert.equal(found.sourceRow,23547);assert.equal(found.location,'C18-1 → C01-1');assert.equal(result.summary.byCategory.MOVEMENT_NOT_REFLECTED,1);assert.equal(fingerprint(found),fingerprint({...found,evidence:'updated',issue:'qty changed'}));});
test('changed ledger snapshots and failed movement RPC do not produce movement warnings or permit complete-notification snapshots',async t=>{mock(t,{changed:true});const result=await loadInventoryWarnings({SUPABASE_URL:'https://project.test',SUPABASE_SECRET_KEY:'sb_secret_test'});assert.equal(result.partial,true);assert.equal(result.rows.some(row=>row.category.startsWith('MOVEMENT_')),false);});
test('failed movement RPC is visible as incomplete coverage',async t=>{mock(t,{unavailable:true});const result=await loadInventoryWarnings({SUPABASE_URL:'https://project.test',SUPABASE_SECRET_KEY:'sb_secret_test'});assert.equal(result.partial,true);assert.ok(result.unavailableSources.includes('movement_impact'));assert.equal(result.checks.find(row=>row.key==='movement').ready,false);});

test('legitimate received movement has positive opening stock and a zero destination transfer, matching real WMS data',()=>{const rows=stock();rows[0].internal_stock_transfer=10;rows[0].stok_akhir=0;rows[1].stok_awal=10;rows[1].stok_akhir=10;const result=check([move()],rows);assert.equal(result.findings.length,0);});
test('destination registered in RPL counts as valid stock evidence and cannot become a false missing-location warning',()=>{const rows=stock().slice(0,1);rows[0].internal_stock_transfer=10;rows.push({...stock()[1],warningSource:'RPL',stok_awal:10,stok_akhir:10});assert.equal(check([move()],rows).findings.length,0);});
test('known impact in a parallel stock source suppresses the assertion that the source movement never had an impact',()=>{const rows=stock();rows[1].stok_awal=10;rows[1].stok_akhir=10;rows.push({...rows[0],warningSource:'BULKY',internal_stock_transfer:10,stok_akhir:0});assert.equal(check([move()],rows).findings.length,0);});
test('omitted opening fields from a compatibility read cannot turn into a blank-formula warning',()=>{const rows=stock();rows[0].internal_stock_transfer=10;delete rows[1].stok_awal;assert.equal(check([move()],rows).findings.length,0);});

test('parallel stock snapshots are evidence and are never summed as if they were additional physical stock',()=>{const rows=stock();rows.push({...rows[0],warningSource:'BULKY'});const found=check([move()],rows).findings[0];assert.match(found.evidence,/saldo 10;/);assert.doesNotMatch(found.evidence,/saldo 20/);});
