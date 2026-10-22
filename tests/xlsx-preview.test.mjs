import test from 'node:test';
import assert from 'node:assert/strict';
import {excelColumn,readXlsxWorkbook} from '../assets/js/xlsx-preview.js';
test('Excel column labels include columns beyond Z',()=>{assert.equal(excelColumn(0),'A');assert.equal(excelColumn(25),'Z');assert.equal(excelColumn(26),'AA');assert.equal(excelColumn(99),'CV');});
test('invalid and truncated workbook archives fail before XML parsing',async()=>{await assert.rejects(readXlsxWorkbook(new Uint8Array([1,2,3]).buffer),/XLSX tidak valid/);const bytes=new Uint8Array(22),view=new DataView(bytes.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(10,1,true);view.setUint32(16,1000,true);await assert.rejects(readXlsxWorkbook(bytes.buffer),/Direktori XLSX tidak valid/);});
test('closing preview aborts archive work before parsing',async()=>{const controller=new AbortController();controller.abort();const bytes=new Uint8Array(22);new DataView(bytes.buffer).setUint32(0,0x06054b50,true);await assert.rejects(readXlsxWorkbook(bytes.buffer,{signal:controller.signal}),{name:'AbortError'});});
