import test from 'node:test';
import assert from 'node:assert/strict';
import {syncAdvanceSourceTabs} from '../assets/js/advance-search.js';

function fixture(){
 const sources=[['detail','Detail SKU'],['movement','Movement'],['cycle','Cycle Count']],tabs=new Map(),panels=new Map();
 for(const [kind]of sources){const count={textContent:''};tabs.set(kind,{hidden:false,attributes:{},querySelector:()=>count,setAttribute(name,value){this.attributes[name]=value;},count});panels.set(kind,{hidden:false});}
 const empty={hidden:true};
 const root={querySelector(selector){if(selector==='[data-advance-no-sources]')return empty;const kind=selector.match(/="(.*?)"/)[1];return selector.includes('jump')?tabs.get(kind):panels.get(kind);}};
 return {sources,tabs,panels,empty,update:(status,active,filled)=>syncAdvanceSourceTabs(root,sources,status,active,filled)};
}
test('source tabs show exactly one panel, preserve loaded content and expose selected state and counts',()=>{
 const f=fixture(),status=new Map([['detail',{status:'loaded',count:4}],['movement',{status:'loaded',count:2}],['cycle',{status:'error'}]]);
 f.panels.get('detail').content='existing rows';
 assert.equal(f.update(status,'detail'),'detail');
 assert.deepEqual([...f.panels.values()].map(panel=>panel.hidden),[false,true,true]);
 assert.equal(f.tabs.get('detail').attributes['aria-selected'],'true');assert.equal(f.tabs.get('detail').tabIndex,0);
 assert.equal(f.tabs.get('movement').count.textContent,'2');assert.equal(f.tabs.get('cycle').count.textContent,'!');
 f.update(status,'movement');
 assert.deepEqual([...f.panels.values()].map(panel=>panel.hidden),[true,false,true]);
 assert.equal(f.panels.get('detail').content,'existing rows');assert.equal(f.tabs.get('detail').tabIndex,-1);
});
test('filled-only filtering switches away from an empty active source and keeps failed/loading sources accessible',()=>{
 const f=fixture(),status=new Map([['detail',{status:'loaded',count:0}],['movement',{status:'loading'}],['cycle',{status:'error'}]]);
 assert.equal(f.update(status,'detail',true),'movement');assert.equal(f.tabs.get('detail').hidden,true);
 assert.equal(f.tabs.get('movement').hidden,false);assert.equal(f.tabs.get('cycle').hidden,false);
 status.set('movement',{status:'loaded',count:0});status.set('cycle',{status:'loaded',count:0});
 assert.equal(f.update(status,'movement',true),'');assert.equal(f.empty.hidden,false);
 assert.ok([...f.panels.values()].every(panel=>panel.hidden));
 assert.equal(f.update(status,'',false),'detail');assert.equal(f.empty.hidden,true);
});
