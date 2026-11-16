import test from 'node:test';
import assert from 'node:assert/strict';
import {createMovementDelivery} from '../assets/js/movement-delivery.js';
const items=[{sku:'0012',from:'A',to:'B',qty:2}];
const complete=()=>Response.json({success:true,destinations:{inventory:'saved',barangMasuk:'saved'}});
function fixture(options={}){const data=options.data||new Map();const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};return {data,delivery:createMovementDelivery({owner:'alice',storage,...options})};}
const tick=()=>new Promise(setImmediate);
test('snapshot stays immutable while a newer batch is edited; slow double submit only POSTs once',async()=>{
 let resolve,calls=0;const {delivery}=fixture({fetchFn:()=>{calls++;return new Promise(r=>resolve=r);}}),draft=structuredClone(items);
 const id=delivery.enqueue(draft),pending=delivery.send(id);await tick();draft[0].qty=9;await delivery.send(id);assert.equal(calls,1);assert.equal(delivery.batches[0].items[0].qty,2);assert.equal(delivery.batches[0].status,'sending');
 resolve(complete());await pending;assert.equal(delivery.batches[0].status,'saved');assert.equal(draft[0].qty,9);
});
test('refresh restores an in-flight batch as uncertain without POST; status GET recovers late success',async()=>{
 const first=fixture();const id=first.delivery.enqueue(items);let calls=[];const second=fixture({data:first.data,fetchFn:async(url,options)=>{calls.push({url,options});return complete();}});
 assert.equal(second.delivery.batches[0].status,'uncertain');await second.delivery.send(id);assert.equal(calls.length,0);await second.delivery.check(id);assert.equal(second.delivery.batches[0].status,'saved');assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);
});
test('network loss, malformed JSON and partial writes stay locked and never retry automatically',async()=>{
 for(const fetchFn of [async()=>{throw TypeError('Offline');},async()=>new Response('bad json'),async()=>Response.json({success:false,writeState:'uncertain',destinations:{inventory:'saved',barangMasuk:'uncertain'}},{status:502}),async()=>Response.json({success:true,destinations:{inventory:'saved'}})]){
  let calls=0;const {delivery}=fixture({fetchFn:async(...args)=>{calls++;return fetchFn(...args);}}),id=delivery.enqueue(items);await delivery.send(id);assert.equal(delivery.batches[0].status,'uncertain');await delivery.send(id);assert.equal(calls,1);assert.throws(()=>delivery.enqueue(items),/identik/);
 }
});
test('a confirmed no-write failure permits retry of the same ID and payload',async()=>{
 const calls=[];const {delivery}=fixture({fetchFn:async(url,options)=>{calls.push(JSON.parse(options.body));return calls.length===1?Response.json({success:false,writeState:'not_started'},{status:503}):complete();}}),id=delivery.enqueue(items);await delivery.send(id);assert.equal(delivery.batches[0].status,'failed');await delivery.send(id);assert.equal(delivery.batches[0].status,'saved');assert.equal(calls[0].id,calls[1].id);assert.deepEqual(calls[0].items,calls[1].items);
});
test('cloud draft failure prevents POST and keeps recoverable snapshot; journal storage failure prevents enqueue',async()=>{
 let calls=0;const {delivery}=fixture({beforeSend:async()=>{throw Error('Draft conflict');},fetchFn:async()=>{calls++;return complete();}}),id=delivery.enqueue(items);await delivery.send(id);assert.equal(calls,0);assert.equal(delivery.batches[0].status,'failed');assert.deepEqual(delivery.batches[0].items,items);
 const broken=createMovementDelivery({owner:'alice',storage:{getItem:()=>null,setItem:()=>{throw Error('Quota');}}});assert.throws(()=>broken.enqueue(items),/Quota/);assert.equal(broken.batches.length,0);
});
test('account switch suppresses UI callbacks but keeps the old owner receipt isolated',async()=>{
 let current=true,resolve,changes=0;const data=new Map(),a=fixture({data,isCurrent:()=>current,onChange:()=>changes++,fetchFn:()=>new Promise(r=>resolve=r)}),id=a.delivery.enqueue(items),pending=a.delivery.send(id);await tick();current=false;const before=changes,b=fixture({data,owner:'bob'});resolve(complete());await pending;assert.equal(changes,before);assert.equal(b.delivery.batches.length,0);assert.equal(fixture({data}).delivery.batches[0].status,'saved');
});
test('account snapshot can recover batches on another device without automatically writing',()=>{
 const a=fixture(),id=a.delivery.enqueue(items),b=fixture();b.delivery.merge(a.delivery.batches);assert.equal(b.delivery.batches[0].id,id);assert.equal(b.delivery.batches[0].status,'uncertain');
});
test('a quota failure after POST does not erase the journal or reject the completion handler',async()=>{
 const data=new Map();let broken=false;const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>{if(broken)throw Error('Quota');data.set(key,value);}};
 const delivery=createMovementDelivery({owner:'alice',storage,fetchFn:async()=>{broken=true;return complete();}}),id=delivery.enqueue(items);await assert.doesNotReject(delivery.send(id));assert.equal(delivery.batches[0].status,'saved');const restored=fixture({data});assert.equal(restored.delivery.batches[0].status,'uncertain');
});

test('JSONB key order changes cannot bypass the unresolved snapshot duplicate guard',()=>{
 const {delivery}=fixture();const reordered=items.map(item=>Object.fromEntries(Object.entries(item).reverse()));delivery.merge([{id:'original',items:reordered,status:'uncertain'}]);assert.throws(()=>delivery.enqueue(items),/identik/);
});
