import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFonnteWebhook } from '../supabase/functions/whatsapp-fonnte/handler.js';

const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const privateKey = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
const row = {tanggal:'2026-10-11',from_location:'A20-1',to_location:'B01',sku:'00123',nama_barang:'Merlyn',qty:7,status:'Barang Masuk',pic:'Andi',keterangan:'Test',source_row_number:42};
const columns = ['tanggal','from_location','to_location','sku','nama_barang','qty','status','pic','keterangan'];
function fixture({allowed=true,stale=false,mirrorFail=false,claimFail=false}={}) {
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-role',FONNTE_TOKEN:'test',FONNTE_WEBHOOK_SECRET:'secret',WHATSAPP_ALLOWED_NUMBERS:'6281234567890',WHATSAPP_EDITOR_NUMBERS:allowed?'6281234567890':'',GOOGLE_CLIENT_EMAIL:'test@example.com',GOOGLE_PRIVATE_KEY:privateKey,SHEET_ID_2026:'test-sheet'};
 let session,live={...row},writes=0,mirrors=0; const replies=[];
 const fetchFn=async(url,options={})=>{
  const q=new URL(url).searchParams;
  if(url.endsWith('/send')) {replies.push(options.body.get('message'));return Response.json({status:true});}
  if(url.includes('whatsapp_search_sessions')) {
   if(options.method==='POST') {session=JSON.parse(options.body).search;return new Response(null,{status:201});}
   if(options.method==='PATCH') {
    if(claimFail||session.phase!=='confirm'||q.get('search->>nonce')!==`eq.${session.nonce}`)return Response.json([]);
    session=JSON.parse(options.body).search;return Response.json([{search:session}]);
   }
   return Response.json(session?[{search:session}]:[]);
  }
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-access'});
  if(url.includes('sheets.googleapis.com')) {
   if(options.method==='POST') {writes++;const body=JSON.parse(options.body);assert.equal(body.valueInputOption,'RAW');for(const item of body.data){const col=/!([A-I])42$/.exec(item.range)[1];live[columns[col.charCodeAt(0)-65]]=item.values[0][0];}return Response.json({});}
   if (decodeURIComponent(url).includes('!A1:I1')) return Response.json({values:[['TANGGAL','FROM','TO','SKU','NAMA BARANG','QTY','STATUS','PIC','KETERANGAN']]});
   return Response.json({values:[columns.map(field=>String(stale&&field==='qty'?999:field==='tanggal'?'10/11/2026':live[field]))]});
  }
  if(options.method==='PATCH') {mirrors++;if(mirrorFail)return Response.json({}, {status:500});return Response.json([{...row,...JSON.parse(options.body)}]);}
  return Response.json([{...row}]);
 };
 const send=async message=>{const request=new Request('https://test/functions/v1/whatsapp-fonnte?secret=secret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sender:'6281234567890',message})});assert.equal((await handleFonnteWebhook({request,env},fetchFn)).status,200);return replies.at(-1);};
 return {send,env,get session(){return session;},get writes(){return writes;},get mirrors(){return mirrors;},get live(){return live;}};
}
async function preview(f,source='masuk') {await f.send(`${source} merlyn`);assert.match(await f.send('edit 1'),/Pilih kolom/);assert.match(await f.send('1'),/Kirim nilai baru/);assert.match(await f.send('12'),/Jumlah: 7 → 12/);assert.equal(f.writes,0);}

test('inbound and outbound edit flow writes only after explicit confirmation and duplicate save is blocked',async()=>{
 for(const source of ['masuk','keluar']){const f=fixture();await preview(f,source);assert.match(await f.send('simpan'),/berhasil disimpan/);assert.equal(f.writes,1);assert.equal(f.mirrors,1);assert.equal(f.live.qty,12);assert.match(await f.send('simpan'),/sudah diproses/);assert.equal(f.writes,1);}
});
test('read-only phone cannot start or save edits',async()=>{const f=fixture({allowed:false});await f.send('masuk merlyn');assert.match(await f.send('edit 1'),/belum memiliki izin/);assert.equal(f.writes,0);});
test('stale source sheet is rejected before mutation',async()=>{const f=fixture({stale:true});await preview(f);assert.match(await f.send('simpan'),/sudah berubah/);assert.equal(f.writes,0);assert.equal(f.mirrors,0);});
test('cancel discards draft and invalid quantity does not progress',async()=>{const f=fixture();await f.send('masuk merlyn');await f.send('edit 1');await f.send('1');assert.match(await f.send('-2'),/angka 0 atau lebih/);assert.equal(f.session.phase,'value');assert.match(await f.send('batal'),/dibatalkan/);assert.equal(f.writes,0);});
test('second field can be added to the review before one batch write',async()=>{const f=fixture();await preview(f);await f.send('ubah');await f.send('3');const text=await f.send('Budi');assert.match(text,/Jumlah: 7 → 12/);assert.match(text,/PIC: Andi → Budi/);await f.send('simpan');assert.equal(f.live.pic,'Budi');assert.equal(f.live.qty,12);assert.equal(f.writes,1);});
test('failed claim prevents duplicate or expired confirmation from writing',async()=>{const f=fixture({claimFail:true});await preview(f);assert.match(await f.send('simpan'),/sudah diproses atau kedaluwarsa/);assert.equal(f.writes,0);});
test('successful Sheets write with failed mirror reports pending synchronization honestly',async()=>{const f=fixture({mirrorFail:true});await preview(f);assert.match(await f.send('simpan'),/Supabase belum terkonfirmasi/);assert.equal(f.writes,1);assert.equal(f.session.phase,'done');});
test('edit selection requires a current transaction and valid row index',async()=>{const f=fixture();assert.match(await f.send('edit 1'),/Cari transaksi dahulu/);await f.send('masuk merlyn');assert.match(await f.send('edit 5'),/Cari transaksi dahulu/);assert.equal(f.writes,0);});
