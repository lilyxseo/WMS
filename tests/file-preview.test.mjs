import test from 'node:test';
import assert from 'node:assert/strict';
import {previewType} from '../assets/js/file-preview.js';
test('preview selects raster images, PDFs and safe text rendering',()=>{for(const [name,type,expected]of [['a.xlsx','','xlsx'],['a','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx'],['a.pdf','','pdf'],['a','application/pdf','pdf'],['a.png','image/png','image'],['a.jpeg','','image'],['a.html','text/html','text'],['a.svg','image/svg+xml','text'],['a.csv','','text'],['a.docx','','unsupported'],['a.exe','application/octet-stream','unsupported']])assert.equal(previewType({name,type}),expected);});
