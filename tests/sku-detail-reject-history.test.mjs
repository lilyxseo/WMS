import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readAdvanceSection,advanceTable,exactSkuRows} from '../assets/js/advance-search.js';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
test('Detail SKU no longer mounts or requests Reject history; source API remains available',()=>{
 const render=source.slice(source.indexOf('function renderSkuDetailPayload'),source.indexOf('const SKU_DETAIL_LOCATION_FIELDS='));
 assert.doesNotMatch(render,/skuRejectHistoryRoot|loadSkuRejectHistory|Barang Masuk Reject|Barang Keluar Reject/);
 assert.match(source,/\/api\/barang-reject/);
});
test('Advance Search preserves both Reject histories, exact SKU, row order and all business fields',async()=>{
 const data=await readAdvanceSection('reject','0012',{request:async url=>{assert.equal(url,'/api/barang-reject');return {warning:'Sebagian sumber',masuk:[{sku:'0012',rowNumber:8,qty:2,noIseller:'#T-008937'},{sku:'12',qty:100},{sku:'0012-X',qty:100},{sku:'0012',rowNumber:2,qty:1}],keluar:[{sku:'0012',qty:3,statusProses:'Selesai'}]};}});
 assert.equal(data.warning,'Sebagian sumber');assert.equal(data.groups[0].name,'Barang Masuk Reject');assert.deepEqual(data.groups[0].rows.map(row=>row.rowNumber),[2,8]);assert.equal(data.groups[0].rows[1].noIseller,'#T-008937');assert.equal(data.groups[1].rows[0].statusProses,'Selesai');
});
test('Advance Search keeps all detail source columns including fields unique to later rows and escapes values',async()=>{
 const data=await readAdvanceSection('detail','A',{request:async()=>({sources:{'Kartu Stock':[{sku:'A',qty:2},{sku:'A',note:'<img src=x onerror=alert(1)>'}],'Barang Masuk':[]}})});
 assert.equal(data.length,2);const html=advanceTable(data[0].rows);assert.match(html,/<th>note<\/th>/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
});
test('Advance Search requests all Movement and paginates Cycle Count after an exact SKU filter',async()=>{
 const urls=[];const request=async url=>{urls.push(url);return {data:[{sku:'0012'},{sku:'12'}],rows:[{sku:'0012'},{sku:'12'}],total:73,page:2,limit:50};};
 assert.equal((await readAdvanceSection('movement','0012',{request})).length,1);
 const cycle=await readAdvanceSection('cycle','0012',{request,page:2});assert.equal(cycle.rows.length,1);assert.equal(cycle.total,73);assert.match(urls[0],/movement\?sku=0012$/);assert.match(urls[1],/sku=0012&page=2&limit=50/);
});
test('unavailable accuracy and failed history remain errors rather than empty success',async()=>{
 await assert.rejects(readAdvanceSection('accuracy','A',{request:async()=>({ready:false,rows:[]})}),/belum siap/);
 await assert.rejects(readAdvanceSection('reject','A',{request:async()=>{throw Error('unavailable');}}),/unavailable/);
 assert.deepEqual(exactSkuRows([{sku:'0001'},{sku:'1'},{sku:'0001-X'}],'0001'),[{sku:'0001'}]);
});
