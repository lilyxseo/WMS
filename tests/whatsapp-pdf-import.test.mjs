import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFonnteWebhook } from '../supabase/functions/whatsapp-fonnte/handler.js';
import { downloadPdf, parsePdfPages, pdfAttachment, MAX_PDF_BYTES } from '../supabase/functions/whatsapp-fonnte/pdf-document.js';
import { transferPages, textItem } from './fixtures/whatsapp-pdf.mjs';

function fixture(options = {}) {
 const env = {FONNTE_TOKEN:'fonnte',FONNTE_WEBHOOK_SECRET:'secret',SUPABASE_URL:'https://db.test',WMS_SUPABASE_SECRET_KEY:'key',WHATSAPP_ALLOWED_NUMBERS:'6281234567890',GOOGLE_OAUTH_CLIENT_ID:'client',GOOGLE_OAUTH_CLIENT_SECRET:'secret',GOOGLE_OAUTH_REFRESH_TOKEN:'refresh',SHEET_ID_INVENTORY:'inventory'};
 const profile = {id:'u1',email:'user@example.com',role:'PIC Inventory',phone_number:'6281234567890',...options.profile};
 let state, saved, auditCount=0, readFail=!!options.readFail, claimFail=!!options.claimFail, writes=[];
 const replies=[];
 const fetchFn=async(url,init={})=>{
  if(url==='https://api.fonnte.com/send') {replies.push(init.body.get('message')); return Response.json({status:true});}
  if(url.startsWith('https://api.fonnte.com/files/')) return new Response('%PDF-file');
  if(url.includes('/users?')) return Response.json(options.missingProfile?[]:[profile]);
  if(url.includes('whatsapp_search_sessions')) {
   if(init.method==='POST') {state=JSON.parse(init.body).search;return new Response(null,{status:201});}
   if(init.method==='PATCH') {
    const q=new URL(url).searchParams;
    if(claimFail||q.get('search->>phase')!==`eq.${state.phase}`||q.get('search->>nonce')!==`eq.${state.nonce}`) return Response.json([]);
    state=JSON.parse(init.body).search;return Response.json([{search:state}]);
   }
   return Response.json(state?[{search:state}]:[]);
  }
  if(url.includes('/activity_logs')) {auditCount++;return new Response(null,{status:options.auditFail?500:201});}
  if(url.includes('oauth2.googleapis.com')) return Response.json({access_token:'token'});
  if(url.includes('sheets.googleapis.com')) {
   if(!init.method) {if(readFail){readFail=false;throw new Error('Connection failed');} return Response.json({sheets:options.duplicate?[{properties:{title:'#T-007894',sheetId:2}}]:[]});}
   writes.push(JSON.parse(init.body));
   if(options.writeFail) throw new Error('Uncertain timeout');
   const properties=writes.at(-1).requests[0].addSheet.properties;saved=properties.title;
   return Response.json({replies:[{addSheet:{properties}}, {}, {}, {}]});
  }
  throw new Error(`Unexpected ${url}`);
 };
 const send=async(message,attachment)=>{
  const request=new Request('https://bot.test?secret=secret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sender:'6281234567890',message,...attachment})});
  const response=await handleFonnteWebhook({request,env,extractPdf:async()=>options.pages||transferPages()},fetchFn);
  assert.equal(response.status,200);return replies.at(-1);
 };
 return {send,env,profile,writes,get state(){return state;},get saved(){return saved;},get auditCount(){return auditCount;},set state(value){state=value;}};
}
const attachment={url:'https://api.fonnte.com/files/transfer.pdf',filename:'transfer.pdf',extension:'pdf'};

test('PDF import reads attachment without caption, previews, then atomically creates Inventory tab after y',async()=>{
 const f=fixture(); assert.match(await f.send(undefined,attachment),/Tinjau Import PDF/);assert.equal(f.writes.length,0);
 assert.match(await f.send('y'),/Import PDF Berhasil/);assert.equal(f.writes.length,1);assert.equal(f.saved,'#T-007894');assert.equal(f.auditCount,1);
 const requests=f.writes[0].requests;
 assert.deepEqual(requests.map(row=>Object.keys(row)[0]),['addSheet','updateCells','repeatCell','autoResizeDimensions']);
 assert.equal(requests[1].updateCells.rows[6].values[0].userEnteredValue.stringValue,'0000');
 assert.equal(requests[1].updateCells.rows[6].values[2].userEnteredValue.numberValue,1);
 assert.equal(requests[0].addSheet.properties.gridProperties.frozenRowCount,6);
 assert.match(await f.send('y'),/sebelumnya sudah diproses/);assert.equal(f.writes.length,1);
});

test('PDF import recognizes extensionless document URLs, MIME variants and whitespace in extension metadata',async()=>{
 for(const payload of [
  {url:'https://api.fonnte.com/files/opaque-token',type:'document'},
  {url:'https://api.fonnte.com/files/opaque-token',type:'file',mimetype:'application/pdf'},
  {url:'https://api.fonnte.com/files/opaque-token',extension:' PDF '},
  {url:'https://api.fonnte.com/files/opaque-token'},
  {file_url:'https://api.fonnte.com/files/opaque-token',mimeType:'application/pdf'},
  {document:{url:'https://api.fonnte.com/files/opaque-token',fileName:'transfer.pdf'}},
 ]) {
  const f=fixture();assert.match(await f.send(undefined,payload),/Tinjau Import PDF/);assert.equal(f.writes.length,0);
 }
 assert.equal(pdfAttachment({url:'https://api.fonnte.com/files/photo',type:'image',extension:'jpg'}),undefined);
});

test('document without download URL explains missing media data and keeps draft ready for resend',async()=>{
 const f=fixture();await f.send('import pdf');const nonce=f.state.nonce;
 const reply=await f.send(undefined,{filename:'transfer.pdf',type:'document',url:''});
 assert.match(reply,/Link PDF belum diterima/);assert.match(reply,/cek pdf/);assert.doesNotMatch(reply,/Webhook File|pengaturan perangkat/);assert.equal(f.state.nonce,nonce);assert.equal(f.state.phase,'file');assert.equal(f.writes.length,0);
 assert.match(await f.send(undefined,{url:'https://api.fonnte.com/files/opaque-token',type:'document'}),/Tinjau Import PDF/);
 const direct=fixture();assert.match(await direct.send(undefined,{filename:'transfer.pdf'}),/Link PDF belum diterima/);assert.equal(direct.state.phase,'file');
 const stock=fixture();stock.state={kind:'stock',phase:'qty'};assert.match(await stock.send(undefined,{filename:'transfer.pdf'}),/Selesaikan input/);assert.equal(stock.state.phase,'qty');
});

test('plain replies while waiting for a PDF explain missing file link instead of repeating initial prompt',async()=>{
 const f=fixture();await f.send('import pdf');const nonce=f.state.nonce;
 assert.match(await f.send('Transfer #T-007894'),/cek pdf/);assert.equal(f.state.nonce,nonce);assert.equal(f.writes.length,0);
});

test('cek pdf reports observed media flags without disclosing file names, URLs, sender or tokens',async()=>{
 const f=fixture();await f.send('import pdf');await f.send(undefined,{filename:'private-transfer.pdf',type:'document',url:'',token:'sensitive'});
 const nonce=f.state.nonce, report=await f.send('cek pdf');
 assert.match(report,/Link unduhan: tidak ada/);assert.match(report,/Nama file: ada/);assert.match(report,/Metadata dokumen: ada/);
 assert.doesNotMatch(report,/private-transfer\.pdf|sensitive|6281234567890|Webhook File/);assert.equal(f.state.nonce,nonce);assert.equal(f.writes.length,0);
 await f.send(undefined,attachment);const withLink=await f.send('cek pdf');assert.match(withLink,/Link unduhan: ada/);assert.doesNotMatch(withLink,/https:\/\/api.fonnte.com|transfer\.pdf/);assert.equal(f.state.phase,'confirm');
 const empty=fixture();assert.match(await empty.send('cek pdf'),/Belum ada data lampiran/);assert.equal(empty.state,undefined);
});

test('PDF preview supports pagination and edits to header and global item number with formula-safe strings',async()=>{
 const f=fixture({pages:transferPages({count:12})});
 assert.match(await f.send('import pdf'),/Kirim PDF/);assert.match(await f.send('',attachment),/Halaman 1\/2/);
 assert.match(await f.send('lanjut'),/Item 11–12/);assert.match(await f.send('edit 11 qty 25'),/Qty: 25/);
 assert.match(await f.send('nomor #T-009999'),/#T-009999/);await f.send('from IWT E-COM');await f.send('to WAREHOUSE');await f.send('edit 1 nama =IMPORTXML("x")');
 assert.match(await f.send('sebelumnya'),/Halaman 1\/2/);assert.match(await f.send('y'),/Import PDF Berhasil/);
 assert.equal(f.saved,'#T-009999');assert.equal(f.writes[0].requests[1].updateCells.rows[6].values[1].userEnteredValue.stringValue,'=IMPORTXML("x")');
});

test('PDF import refuses duplicate transfer, canceled draft, expired claim, and read-only or unregistered profile',async()=>{
 const duplicate=fixture({duplicate:true});await duplicate.send('',attachment);assert.match(await duplicate.send('y'),/sudah tersedia/);assert.equal(duplicate.writes.length,0);
 const cancel=fixture();await cancel.send('',attachment);assert.match(await cancel.send('batal'),/dibatalkan/);assert.deepEqual(cancel.state,{});assert.equal(cancel.writes.length,0);
 const claimed=fixture({claimFail:true});await claimed.send('',attachment);assert.match(await claimed.send('y'),/draft kedaluwarsa/);assert.equal(claimed.writes.length,0);
 for(const options of [{profile:{role:'Staff'}},{missingProfile:true}]) {const f=fixture(options);assert.match(await f.send('',attachment),/read-only|belum terdaftar/);assert.equal(f.writes.length,0);}
});

test('PDF retry retains parsed rows after pre-write connection failure but never repeats uncertain write',async()=>{
 const retry=fixture({readFail:true});await retry.send('',attachment);assert.match(await retry.send('y'),/Balas ulang/);assert.equal(retry.state.phase,'retry');
 assert.match(await retry.send('ulang'),/Import PDF Berhasil/);assert.equal(retry.writes.length,1);
 const uncertain=fixture({writeFail:true});await uncertain.send('',attachment);assert.match(await uncertain.send('y'),/belum terkonfirmasi/);
 assert.match(await uncertain.send('ulang'),/sebelumnya sudah diproses/);assert.equal(uncertain.writes.length,1);
});

test('PDF access rechecked at confirmation, and audit failure does not suggest repeating saved import',async()=>{
 const f=fixture();await f.send('',attachment);f.profile.role='Staff';assert.match(await f.send('y'),/read-only/);assert.equal(f.writes.length,0);
 const audit=fixture({auditFail:true});await audit.send('',attachment);assert.match(await audit.send('y'),/sheet sudah tersimpan/);assert.equal(audit.writes.length,1);
 assert.match(await audit.send('ulang'),/sebelumnya sudah diproses/);assert.equal(audit.writes.length,1);
});

test('PDF cannot replace an unfinished stock transaction or an uncertain saving state',async()=>{
 const f=fixture();f.state={kind:'stock',phase:'qty'};assert.match(await f.send('',attachment),/Selesaikan input/);assert.equal(f.state.phase,'qty');
 f.state={phase:'field'};assert.match(await f.send('import pdf'),/Selesaikan input/);assert.equal(f.state.phase,'field');
 f.state={kind:'stock',phase:'saving'};assert.match(await f.send('',attachment),/belum terkonfirmasi/);assert.equal(f.writes.length,0);
});

test('PDF parsing preserves counters and wrapped names, handles multipage totals, and requests missing transfer number',async()=>{
 const first=transferPages()[0];first.splice(first.length-1,0,textItem('GOLD EDITION',40,640));
 const parsed=parsePdfPages([first,...transferPages()]);assert.equal(parsed.rows.length,4);assert.equal(parsed.rows[0].namaProduk,'MERLYN WHITE 0 GOLD EDITION');assert.equal(parsed.rows[0].diterima,'0');
 const withoutNumber=transferPages();withoutNumber[0]=withoutNumber[0].filter(item=>!item.str.startsWith('Transfer '));
 const f=fixture({pages:withoutNumber});assert.match(await f.send('',attachment),/Nomor transfer belum terdeteksi/);assert.match(await f.send('#T-001234'),/Tinjau Import PDF/);assert.equal(f.state.header.transferNumber,'#T-001234');
});

test('PDF scan, partial invalid rows, excessive rows and invalid edit values block writes',async()=>{
 assert.throws(()=>parsePdfPages([[]]),/tidak memiliki teks/);
 const pages=transferPages();pages[0].find(item=>item.transform[4]===400&&item.transform[5]===650).str='INVALID';
 assert.throws(()=>parsePdfPages(pages),/gagal dibaca|belum valid/);
 const missingSku=transferPages();missingSku[0].find(item=>item.transform[4]===270&&item.transform[5]===650).str='';
 assert.throws(()=>parsePdfPages(missingSku),/gagal dibaca/);
 const f=fixture();await f.send('',attachment);assert.match(await f.send('edit 1 qty NaN'),/tidak valid/);assert.match(await f.send('nomor a/b'),/Nomor transfer/);assert.equal(f.writes.length,0);
});

test('PDF download restricts HTTPS hosts and redirects, enforces streaming size and validates actual file content',async()=>{
 assert.ok(pdfAttachment({...attachment,message:undefined}));
 for(const url of ['http://api.fonnte.com/a.pdf','https://127.0.0.1/a.pdf','https://fonnte.com.evil.test/a.pdf']) {
  await assert.rejects(downloadPdf({url},{},()=>{throw new Error('must not fetch');}),/Host/);
 }
 await assert.rejects(downloadPdf(attachment,{},async()=>new Response(null,{status:302,headers:{Location:'http://localhost/a'}})),/Host/);
 await assert.rejects(downloadPdf(attachment,{},async()=>new Response('not-pdf')),/bukan PDF/);
 await assert.rejects(downloadPdf(attachment,{},async()=>new Response(new Uint8Array(MAX_PDF_BYTES+1))),/maksimal 8 MB/);
 assert.equal(new TextDecoder().decode(await downloadPdf(attachment,{},async()=>new Response('%PDF-1.4'))),'%PDF-1.4');
});
