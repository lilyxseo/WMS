import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceBoolean,advanceColumns,advanceCell,advanceTable} from '../assets/js/advance-table.js';
test('actual and string booleans render checked/unchecked indicators instead of literal values',()=>{
 for(const value of [true,'TRUE',' true ']){const html=advanceCell(value);assert.match(html,/is-checked/);assert.match(html,/aria-label="Dicentang"/);assert.doesNotMatch(html,/>true</i);}
 for(const value of [false,'FALSE',' false ']){const html=advanceCell(value);assert.doesNotMatch(html,/is-checked/);assert.match(html,/aria-label="Tidak dicentang"/);assert.doesNotMatch(html,/>false</i);}
 assert.equal(advanceBoolean(0),null);assert.equal(advanceBoolean('0012'),null);assert.equal(advanceCell(0),'0');assert.equal(advanceCell('0012'),'0012');
});
test('row metadata and redundant checkbox/SKU columns are hidden without mutating the source',()=>{
 const rows=[{rowNumber:8,source_row_number:20,baris:5,tabel:2,__rowNumber:9,sku:'0012',SKU:'0012','Display Name':'0012',checkedRaw:'TRUE',checked:true,'Sumber Sheet':'TRIP 1',qty:0}];const copy=JSON.stringify(rows),columns=advanceColumns(rows);assert.deepEqual(columns,['sku','checked','Sumber Sheet','qty']);const html=advanceTable(rows);assert.doesNotMatch(html,/<th[^>]*>(?:rowNumber|baris|tabel|source_row_number)/i);assert.match(html,/Sumber Sheet/);assert.equal(JSON.stringify(rows),copy);
});
test('different Display Name content and business No column remain visible',()=>{
 assert.deepEqual(advanceColumns([{sku:'0012','Display Name':'Product A',No:4}]),['sku','Display Name','No']);
});
test('safe web links become external buttons and multiple links retain surrounding text',()=>{
 const html=advanceCell('Dokumen https://docs.google.com/a dan https://example.com/b','dokumen');assert.equal((html.match(/class="advance-link-button"/g)||[]).length,2);assert.match(html,/Lihat dokumen 1/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);assert.match(html,/ dan /);assert.match(html,/href="https:\/\/docs.google.com\/a"/);
});
test('untrusted HTML and non-web URL schemes cannot create executable elements or links',()=>{
 for(const value of ['<img src=x onerror=alert(1)>','javascript:alert(1)','data:text/html,<script>alert(1)</script>']){const html=advanceCell(value);assert.doesNotMatch(html,/<img|<script|href=/);}
 const html=advanceCell('https://example.com/?a=1&b=2');assert.match(html,/&amp;b=2/);assert.equal(advanceCell(null).includes('aria-label="Kosong"'),true);
});
test('equivalent location aliases render once and coalesce missing values without changing source data',()=>{
 const rows=[{lokasi:'A01-1',lokasi_bulky:'A01-1',sku:'0012'},{lokasi:'',lokasi_bulky:'B01-1',sku:'0012'},{lokasi:'C01-1',lokasi_bulky:null,sku:'0012'}];const copy=JSON.stringify(rows);assert.deepEqual(advanceColumns(rows),['lokasi','sku']);const html=advanceTable(rows);assert.equal((html.match(/>Lokasi<\/th>/g)||[]).length,1);assert.match(html,/B01-1/);assert.match(html,/C01-1/);assert.equal(JSON.stringify(rows),copy);
});
test('conflicting alias values remain visible with distinct headers instead of silently discarding data',()=>{
 const rows=[{lokasi:'A01',lokasi_bulky:'B01',sku:'0012'}];assert.deepEqual(advanceColumns(rows),['lokasi','lokasi_bulky','sku']);const html=advanceTable(rows);assert.match(html,/Lokasi \(lokasi\)/);assert.match(html,/Lokasi \(lokasi_bulky\)/);assert.match(html,/A01/);assert.match(html,/B01/);
});
test('case and separator aliases share one column, including SKU leading zeros and checkbox values',()=>{
 const rows=[{SKU:'0012',sku:'0012',nama_barang:'Product',namaBarang:'Product',checkedRaw:'TRUE',checked:true}];assert.deepEqual(advanceColumns(rows),['sku','nama_barang','checked']);assert.equal((advanceTable(rows).match(/is-checked/g)||[]).length,1);
});
