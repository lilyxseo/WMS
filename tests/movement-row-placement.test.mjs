import test from 'node:test';
import assert from 'node:assert/strict';
import {firstEmptyMovementRow,buildMovementWriteRequests} from '../functions/api/movement/_delivery.js';
const header=['TANGGAL','FROM','TO','SKU','Nama Barang','Qty','Status','PIC','KETERANGAN'];
const existing=['11/1/2026','A','B','OLD','Existing',3];
const job={id:'batch',payload_hash:'hash'};
const build=(start,sku='0012',rowCount=30000)=>buildMovementWriteRequests({sheet:{sheetId:7,gridProperties:{rowCount}},start,values:[['2026-11-16','A','B',sku,'Product',2,'Movement','ABI','INTERNAL STOCK TRANSFER']],job,destination:'barangMasuk',businessDate:'2026-11-16'});
test('Movement fills the next empty business row before 26000 template rows and misplaced bottom entries',()=>{
 const rows=[header,existing,...Array.from({length:26000},()=>['','','','','','','Movement','ABI'])];rows.push(['11/16/2026','A','B','MISPLACED','Keep this',2]);
 const start=firstEmptyMovementRow(rows,'barangMasuk');assert.equal(start,2);
 const requests=build(start);assert.equal(requests[0].insertDimension.range.startIndex,2);assert.equal(requests[1].updateCells.start.rowIndex,2);assert.equal(requests.some(request=>request.appendCells),false);assert.equal(rows.at(-1)[3],'MISPLACED');
});
test('both destinations skip existing partial rows, preserve zero values and tolerate a prefixed header',()=>{
 for(const destination of ['inventory','barangMasuk']){
  const rows=[['Movement history'],[],header,existing,['','','','0000'],['','','','','Partial name'],['','','','','','','Movement','ABI']];
  assert.equal(firstEmptyMovementRow(rows,destination),6);
 }
 assert.equal(firstEmptyMovementRow([header,existing,['','','','','',0]],'barangMasuk'),3);
 assert.equal(firstEmptyMovementRow([header,existing,['','','','','',0,0]],'inventory'),2);
 assert.throws(()=>firstEmptyMovementRow([['wrong header'],existing],'barangMasuk'),/Header/);
});
test('two batches observing the same empty row insert without overwriting each other or older data',()=>{
 const rows=[header,existing,[],['date','X','Y','MISPLACED','Keep this',8]],before=structuredClone(rows[3]);
 function apply(requests){for(const request of requests){if(request.insertDimension){const {startIndex,endIndex}=request.insertDimension.range;rows.splice(startIndex,0,...Array.from({length:endIndex-startIndex},()=>[]));}if(request.updateCells){request.updateCells.rows.forEach((row,index)=>{rows[request.updateCells.start.rowIndex+index]=row.values.map(cell=>cell.userEnteredValue.stringValue??cell.userEnteredValue.numberValue);});}}}
 const start=firstEmptyMovementRow(rows,'barangMasuk');apply(build(start,'0012'));apply(build(start,'0013'));
 assert.equal(rows[1][3],'OLD');assert.equal(rows[2][3],'0013');assert.equal(rows[3][3],'0012');assert.deepEqual(rows[5],before);
});
test('capacity expansion, date format, string SKU and receipt remain in the same atomic write',()=>{
 const requests=build(2,'0012',2);assert.equal(requests[0].appendDimension.length,1);const write=requests.find(request=>request.updateCells).updateCells;
 assert.equal(write.rows[0].values[3].userEnteredValue.stringValue,'0012');assert.equal(write.rows[0].values[0].userEnteredFormat.numberFormat.type,'DATE');assert.ok(requests.at(-1).createDeveloperMetadata);
});
