import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFonnteWebhook, parseInventoryMessage, formatInventoryReply } from '../supabase/functions/whatsapp-fonnte/handler.js';
import { parseAdvancedCommand } from '../supabase/functions/whatsapp-fonnte/commands.js';
import { SEARCH_MENU, renderMenu, resolveMenu } from '../supabase/functions/whatsapp-fonnte/menu.js';
import { buildInventorySearchQuery } from '../supabase/functions/whatsapp-fonnte/inventory-search.js';
import { transactionMatches, searchTransactions } from '../supabase/functions/whatsapp-fonnte/transactions.js';
const env = { FONNTE_TOKEN:'test-token', FONNTE_WEBHOOK_SECRET:'test-secret', WHATSAPP_ALLOWED_NUMBERS:'081234567890,081234567891', SUPABASE_URL:'https://test.supabase.co', WMS_SUPABASE_SECRET_KEY:'sb_secret_test' };
function request(message, sender='6281234567890', secret='test-secret') { return new Request(`https://wms.test/functions/v1/whatsapp-fonnte?secret=${secret}`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sender,message}) }); }
function harness({stock=[],transactions=[]}={}) {
 const sessions=new Map(), sent=[], reads=[];
 const fetchFn=async(url,options={})=>{
  if(url.endsWith('/send')) { sent.push(options.body.get('message')); return Response.json({status:true}); }
  const parsed=new URL(url), q=parsed.searchParams;
  if(url.includes('whatsapp_search_sessions')) {
   if(options.method==='POST') { const value=JSON.parse(options.body); sessions.set(value.sender,value); return new Response(null,{status:201}); }
   const value=sessions.get(q.get('sender').slice(3));
   return Response.json(value && Date.parse(value.expires_at)>Date.now() ? [{search:value.search}] : []);
  }
  reads.push(url);
  if(url.includes('inventory_barang_')) return Response.json(transactions);
  assert.ok(url.includes('inventory_kartu_stok'));
  const all=q.get('stok_akhir')==='neq.0' ? stock.filter(r=>Number(r.stok_akhir)!==0) : stock;
  const start=Number(q.get('offset')||0);return Response.json(all.slice(start,start+Number(q.get('limit'))));
 };
 return {fetchFn,sessions,sent,reads};
}
const item=(n,qty=7)=>({sku:`SKU${n}`,nama_barang:'GOTO MERLYN GALLON PUMP GREEN GOLD',lokasi_bulky:'A20-1',stok_akhir:qty,synced_at:'2026-10-11T00:00:00Z'});
async function send(h,message,sender) { const response=await handleFonnteWebhook({request:request(message,sender),env},h.fetchFn);assert.equal(response.status,200); return h.sent.at(-1); }

test('unauthorized senders and invalid webhook secret cannot read data',async()=>{
 const forbidden=()=>{throw new Error('unexpected fetch');};
 assert.equal((await handleFonnteWebhook({request:request('merlyn',undefined,'bad'),env},forbidden)).status,401);
 for(const sender of ['628999','group@g.us']) assert.equal((await handleFonnteWebhook({request:request('merlyn',sender),env},forbidden)).status,200);
 assert.equal((await handleFonnteWebhook({request:request('merlyn'),env:{}},forbidden)).status,503);
 assert.equal((await handleFonnteWebhook({request:new Request('https://test/'),env},forbidden)).status,405);
});
test('global reads only Kartu Stok and displays ten rows, with proper next-page offset',async()=>{
 const h=harness({stock:Array.from({length:13},(_,i)=>item(i))});
 const first=await send(h,'merlyn a20-1');
 assert.equal(h.reads.length,1);assert.match(h.reads[0],/limit=11/);
 assert.match(first,/10 baris ditampilkan/);assert.match(first,/SKU: SKU9/);assert.doesNotMatch(first,/SKU: SKU10/);
 assert.match(first,/merlyn a20-1; halaman=2/);assert.match(first,/Tampilkan stok 0\? y\/n/);
 const next=await send(h,'merlyn a20-1; halaman=2');
 assert.match(h.reads[1],/offset=10/);assert.match(next,/SKU: SKU10/);assert.match(next,/3 baris ditampilkan/);
 assert.doesNotMatch(next,/maksimal 3 baris per sumber/);
});
test('name and location tokens remain ANDed while matching different columns',()=>{
 const url=new URL(`https://test/?x=1${buildInventorySearchQuery('merlyn a20-1',['sku','nama_barang','lokasi_bulky'])}`);
 const clause=url.searchParams.get('and');assert.ok(clause.includes('nama_barang.ilike.*merlyn*'));assert.ok(clause.includes('lokasi_bulky.ilike.*a20-1*'));assert.equal(url.searchParams.has('or'),false);
 for(const query of ['merlyn green gold','merlyn 6840']) assert.equal(transactionMatches({sku:'GOTO-006840',nama_barang:'MERLYN GREEN GOLD'},[{query,fields:['sku','nama_barang']}]),true);
});
test('y restores last search across requests and shows zero plus nonzero; n hides zero again',async()=>{
 const h=harness({stock:[item('ZERO',0),item('LIVE',8)]});
 const first=await send(h,'merlyn a20-1');assert.doesNotMatch(first,/SKU: SKUZERO/);
 const yes=await send(h,'y');assert.match(yes,/SKU: SKUZERO/);assert.match(yes,/SKU: SKULIVE/);assert.match(yes,/Stok: 0/);
 assert.ok(h.reads[1].includes('merlyn'));assert.ok(h.reads[1].includes('a20-1'));assert.equal(new URL(h.reads[1]).searchParams.has('stok_akhir'),false);
 const no=await send(h,'n');assert.doesNotMatch(no,/SKU: SKUZERO/);assert.match(no,/SKU: SKULIVE/);
});
test('y after an empty nonzero result still finds zero stock',async()=>{
 const h=harness({stock:[item('ZERO',0)]});assert.match(await send(h,'merlyn'),/tidak ditemukan/);
 assert.match(await send(h,'y'),/SKU: SKUZERO/);
});
test('search contexts are isolated by sender and expire',async()=>{
 const h=harness({stock:[item(1)]});await send(h,'merlyn a20-1');
 assert.match(await send(h,'y','6281234567891'),/kedaluwarsa/);assert.equal(h.reads.length,1);
 h.sessions.get('6281234567890').expires_at='2000-01-01T00:00:00Z';
 assert.match(await send(h,'n'),/kedaluwarsa/);assert.equal(h.reads.length,1);
});
test('yes preference is retained by the next-page command',async()=>{
 const h=harness({stock:Array.from({length:12},(_,i)=>item(i,i%2?5:0))});await send(h,'merlyn');
 const yes=await send(h,'y');assert.match(yes,/merlyn; stok=semua; halaman=2/);
 const next=await send(h,'merlyn; stok=semua; halaman=2');assert.match(next,/SKU: SKU10/);assert.match(next,/Stok: 0/);
});
test('dedicated inbound and outbound queries remain independent of stock and do not overwrite context',async()=>{
 const h=harness({stock:[item(1)],transactions:[{sku:'6840',nama_barang:'Merlyn',qty:12,pic:'Andi',from_location:'A20-1',to_location:'B01',tanggal:'10/11/2026'}]});await send(h,'merlyn');
 for(const command of ['masuk merlyn','keluar merlyn']) {const text=await send(h,command);assert.match(text,/Jumlah transaksi: 12/);assert.match(text,/PIC: Andi/);assert.doesNotMatch(text,/Tampilkan stok 0/);}
 assert.equal(h.sessions.get('6281234567890').search.command,'merlyn');
});
test('legacy aliases, structured filters and menu registry stay usable',async()=>{
 assert.deepEqual(parseInventoryMessage('SKU 00123'),{query:'00123',fields:['sku']});
 assert.equal(parseAdvancedCommand('cari nama=merlyn; lokasi=a20-1').filters.length,2);
 const h=harness();for(const command of ['menu','halo','1','menu masuk']) {assert.match(await send(h,command),/Ketik menu|kembali/);}
 assert.equal(h.reads.length,0);for(const entry of SEARCH_MENU) {assert.ok(renderMenu().includes(entry.example));assert.ok(resolveMenu(entry.id).includes(entry.example));}
});
test('formatting preserves zero values and neutralizes user-controlled markdown',()=>{
 const text=formatInventoryReply([{sku:'*001*\nnext',nama_barang:'_Merlyn_',stok_akhir:0,source:'Kartu Stock'}]);assert.match(text,/SKU: 001 next/);assert.match(text,/Stok: 0/);assert.doesNotMatch(text,/_Merlyn_/);
});
test('database and session failures produce an honest error; send rejection returns 502',async()=>{
 const fetchFn=async(url,options)=>url.endsWith('/send')?(assert.match(options.body.get('message'),/Database WMS belum dapat diakses/),Response.json({status:false})):Response.json({}, {status:500});
 assert.equal((await handleFonnteWebhook({request:request('merlyn'),env},fetchFn)).status,502);
});
test('transaction scan detects history beyond its explicit bound',async()=>{
 let calls=0;const fetchFn=async()=>Response.json(Array.from({length:++calls===6?1:1000},()=>({sku:'OTHER'})));
 const result=await searchTransactions({url:'https://test/',key:'test'},'inventory_barang_masuk','Barang Masuk',{page:1,filters:[{query:'missing',fields:['sku']}]},fetchFn);assert.equal(result.incomplete,true);assert.equal(calls,6);
});
