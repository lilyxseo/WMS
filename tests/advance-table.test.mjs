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
