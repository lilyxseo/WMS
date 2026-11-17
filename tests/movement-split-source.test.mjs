import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const frontend=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
const add=frontend.slice(frontend.indexOf('function addMovementItem('),frontend.indexOf('\nfunction normalizeRole('));

test('the same Movement source can be added twice with independent destinations and quantities',()=>{
 const state={sessionItems:[],submitting:false},messages=[];
 const context=vm.createContext({MOVEMENT_STATE:state,renderMovementSessionTable(){},toast:(...args)=>messages.push(args)});
 vm.runInContext(add,context);
 const source={sku:'0012',lokasi:'A01',nama:'Product',stok_akhir:10};
 assert.equal(context.addMovementItem(source),true);
 Object.assign(state.sessionItems[0],{to:'B01',stokAktual:4});
 assert.equal(context.addMovementItem(source),true);
 assert.equal(state.sessionItems.length,2);
 assert.equal(state.sessionItems[1].to,'');
 assert.equal(state.sessionItems[1].stokAktual,null);
 Object.assign(state.sessionItems[1],{to:'C01',stokAktual:6});
 assert.deepEqual(state.sessionItems.map(({sku,lokasi,to,stokAktual})=>({sku,lokasi,to,stokAktual})),[
  {sku:'0012',lokasi:'A01',to:'B01',stokAktual:4},
  {sku:'0012',lokasi:'A01',to:'C01',stokAktual:6},
 ]);
 assert.equal(messages.some(([,type])=>type==='error'),false);
 state.submitting=true;
 assert.equal(context.addMovementItem(source),false);
 assert.equal(state.sessionItems.length,2);
});
