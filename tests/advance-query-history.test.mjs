import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdvanceSearchHistory} from '../assets/js/advance-search-history.js';
import {mountAdvanceSearch} from '../assets/js/advance-search.js';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};

test('query history persists per account, deduplicates and retains the latest 20 searches',()=>{
 const storage=memory(),history=createAdvanceSearchHistory({account:'one',storage});
 history.add('0012');history.add('Product');history.add(' 0012 ');
 assert.deepEqual(history.entries,['0012','Product']);
 assert.deepEqual(createAdvanceSearchHistory({account:'one',storage}).entries,history.entries);
 assert.deepEqual(createAdvanceSearchHistory({account:'two',storage}).entries,[]);
 for(let i=0;i<25;i++)history.add('SKU'+i);
 assert.equal(history.entries.length,20);assert.equal(history.entries[0],'SKU24');
 history.add('sku24');assert.equal(history.entries.length,20);assert.equal(history.entries[0],'sku24');
 history.clear();assert.deepEqual(createAdvanceSearchHistory({account:'one',storage}).entries,[]);
});

test('history tolerates unavailable storage, invalid data, empty queries and preserves leading zeroes',()=>{
 const storage={getItem(){return '{broken';},setItem(){throw Error('quota');},removeItem(){throw Error('blocked');}};
 const history=createAdvanceSearchHistory({account:'one',storage});
 history.add('  ');history.add(null);assert.deepEqual(history.entries,[]);
 history.add('0012');assert.deepEqual(history.entries,['0012']);history.clear();assert.deepEqual(history.entries,[]);
});

test('Advance Search renders safe clickable history, repeats searches and clears it',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:memory()});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;});
 const node=()=>({innerHTML:'',value:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},removeEventListener(type){delete this.listeners[type];},insertAdjacentHTML(){},replaceChildren(){this.innerHTML='';}});
 const elements=Object.fromEntries(['form','history','results','profile'].map(name=>[name,node()])),input=node(),urls=[];
 const root={isConnected:true,innerHTML:'',querySelector(selector){return selector==='#advanceQuery'?input:elements[selector.match(/data-advance-(.+)\]/)?.[1]];},addEventListener(){},removeEventListener(){}};
 const controller=mountAdvanceSearch(root,{account:'one',fetchFn:async url=>{urls.push(url);return Response.json({rows:[]});}});
 input.value='0012';await elements.form.listeners.submit({preventDefault(){}});
 assert.match(elements.history.innerHTML,/Riwayat pencarian/);
 assert.match(elements.history.innerHTML,/data-advance-history-query="0012"/);
 input.value='other';
 elements.history.listeners.click({target:{closest:selector=>selector==='[data-advance-history-query]'?{dataset:{advanceHistoryQuery:'0012'}}:null}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(input.value,'0012');assert.equal(urls.length,2);assert.ok(urls.every(url=>url.includes('q=0012')));
 input.value='<img src=x onerror=alert(1)>';await elements.form.listeners.submit({preventDefault(){}});
 assert.doesNotMatch(elements.history.innerHTML,/<img/);assert.match(elements.history.innerHTML,/&lt;img/);
 elements.history.listeners.click({target:{closest:selector=>selector==='[data-advance-history-clear]'?{}:null}});
 assert.equal(elements.history.innerHTML,'');
 assert.deepEqual(createAdvanceSearchHistory({account:'one'}).entries,[]);
 controller.dispose();assert.equal(elements.history.listeners.click,undefined);
});
