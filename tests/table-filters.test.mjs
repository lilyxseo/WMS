import test from 'node:test';
import assert from 'node:assert/strict';
import {filterMatches,filterRowMatches,compareFilterValues,parseFilterNumber} from '../assets/js/table-filters.js';
test('column conditions compare text without case sensitivity and preserve exact value selection',()=>{
 assert.equal(filterMatches('Merlyn Green Gold',{condition:'contains',text:'GREEN',values:null}),true);
 assert.equal(filterMatches('Merlyn Green Gold',{condition:'notContains',text:'green',values:null}),false);
 assert.equal(filterMatches('00123',{condition:'',values:['123']}),false);
 assert.equal(filterMatches('anything',{condition:'',values:[]}),false);
 assert.equal(filterMatches('',{condition:'empty',values:['']}),true);
 assert.equal(filterMatches('0',{condition:'notEmpty',values:null}),true);
 for(const [condition,text] of [['starts','merlyn'],['ends','gold'],['equals','merlyn green gold']])assert.equal(filterMatches('Merlyn Green Gold',{condition,text,values:null}),true);
});
test('numeric comparisons reject blanks and invalid numbers and include zero',()=>{
 assert.equal(filterMatches('0',{condition:'gte',text:'0',values:null}),true);
 assert.equal(filterMatches('',{condition:'lt',text:'10',values:null}),false);
 assert.equal(filterMatches('SKU123',{condition:'gt',text:'10',values:null}),false);
 assert.equal(filterMatches('12',{condition:'lte',text:'12',values:null}),true);
});
test('multiple columns combine with AND and values exclude only the current column when building facets',()=>{
 const rules={0:{condition:'contains',text:'merlyn',values:null},1:{condition:'',values:['A20-1']}};
 assert.equal(filterRowMatches(['MERLYN WHITE','A20-1'],rules),true);
 assert.equal(filterRowMatches(['MERLYN WHITE','A20-2'],rules),false);
 assert.equal(filterRowMatches(['MERLYN WHITE','A20-2'],rules,1),true);
});
test('sorting is numeric for quantities and natural for location codes',()=>{
 assert.ok(compareFilterValues('10','2')>0);assert.ok(compareFilterValues('A2','A10')<0);
 assert.ok(compareFilterValues('','0')>0);assert.equal(compareFilterValues('MERLYN','merlyn'),0);
});

test('Indonesian quantity formats sort and compare as numbers',()=>{assert.equal(parseFilterNumber('1.000'),1000);assert.equal(parseFilterNumber('1.250,5'),1250.5);assert.equal(parseFilterNumber('1,5'),1.5);assert.ok(compareFilterValues('1.000','20',true)>0);assert.equal(filterMatches('1.000',{condition:'gt',text:'900',values:null}),true);});
