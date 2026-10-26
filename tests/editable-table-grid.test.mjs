import test from 'node:test';
import assert from 'node:assert/strict';
import {gridMove,gridBounds,parseGridPaste,planGridPaste} from '../assets/js/editable-table-grid.js';
const target=(value,editable=true)=>({value,editable});
test('spreadsheet arrows skip protected cells and Ctrl arrows stop at data boundaries',()=>{
 const row=[target('SKU',false),target('A'),target('B'),target(''),target('D')];
 assert.deepEqual(gridMove([row],{row:0,col:1},'ArrowLeft'),{row:0,col:1});
 assert.deepEqual(gridMove([row],{row:0,col:1},'ArrowRight',{jump:true}),{row:0,col:2});
 assert.deepEqual(gridMove([row],{row:0,col:2},'ArrowRight',{jump:true}),{row:0,col:4});
 assert.deepEqual(gridMove([row],{row:0,col:4},'ArrowRight'),{row:0,col:4});
});
test('range bounds work when selecting backwards and TSV keeps empty cells',()=>{
 assert.deepEqual(gridBounds({anchor:{row:3,col:4},active:{row:1,col:2}}),{top:1,bottom:3,left:2,right:4});
 assert.deepEqual(parseGridPaste('A\t\r\nB\tC\r\n'),[['A',''],['B','C']]);
});
test('paste rejects protected cells and page overflow before any writes',()=>{
 const matrix=[[target('a'),target('locked',false)],[target('b'),target('c')]];
 assert.throws(()=>planGridPaste(matrix,{row:0,col:0},[['new','bad']]),/tidak dapat diedit/);
 assert.equal(matrix[0][0].value,'a');
 assert.throws(()=>planGridPaste(matrix,{row:1,col:0},[['a'],['b']]),/melewati/);
 assert.throws(()=>planGridPaste(matrix,{row:0,col:0},[Array(1001).fill('x')]),/1000/);
 const patches=planGridPaste(matrix,{row:1,col:0},[['2','3']]);assert.deepEqual(patches.map(p=>p.value),['2','3']);
});

test('selectable readonly cells support arrow navigation while paste still rejects their modification',()=>{const matrix=[[{value:'45',editable:false,selectable:true},{value:'SKU-A',editable:false,selectable:true},{value:'Item',editable:false,selectable:true},{value:'A10-1',editable:true}]];assert.deepEqual(gridMove(matrix,{row:0,col:3},'ArrowLeft'),{row:0,col:2});assert.deepEqual(gridMove(matrix,{row:0,col:0},'ArrowRight'),{row:0,col:1});assert.throws(()=>planGridPaste(matrix,{row:0,col:0},[['46','NEW','New name']]),/tidak dapat diedit/);assert.equal(matrix[0][0].value,'45');});
