import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
function fixture(edit=true){
 const state={filters:{},masuk:[],keluar:[],page:{masuk:1,keluar:1},pageSize:25,lastSync:1};
 const context=vm.createContext({BARANG_REJECT_STATE:state,rejectTokensMatch:()=>true,dateInRange:()=>true,canCrud:()=>edit,esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),sumQty:rows=>rows.reduce((n,r)=>n+(Number(r.qty)||0),0),orderRejectSheetRows:r=>r,filteredRejectRows:kind=>state[kind],paginateReject:rows=>rows,renderDataSkeletonRows:()=>'',document:{}});
 vm.runInContext(source.slice(source.indexOf('function rejectPager('),source.indexOf('function todayIso()')),context);
 return {context,state};
}
test('both reject ledgers retain all business columns and row identities in table and compact view',()=>{
 const {context,state}=fixture();const row={rowNumber:42,sku:'0012',namaBarang:'Product',qty:7,from:'STORE A',to:'REJECT',noIseller:'#T-01',statusProses:'Selesai',stckoutReject:'OUT-1'};
 for(const kind of ['masuk','keluar']){
  state[kind]=[row];const html=kind==='masuk'?context.renderRejectIn():context.renderRejectOut();
  assert.match(html,/1<\/strong> transaksi/);assert.match(html,/7<\/strong> qty/);assert.match(html,/data-row="42"/);
  assert.match(html,/#T-01/);assert.match(html,/<dt>No iSeller<\/dt>/);
  assert.match(html,kind==='masuk'?/<dt>STCKOUT Reject<\/dt>/:/<dt>Status Proses<\/dt>/);
  assert.match(html,/data-reject-ledger="(masuk|keluar)"/);
 }
});
test('compact cards escape untrusted spreadsheet data and respect read-only permissions',()=>{
 const {context,state}=fixture(false);state.masuk=[{sku:'<img src=x>',namaBarang:'<script>bad</script>',noIseller:'<svg onload=bad>',qty:1,rowNumber:8,statusBarang:'"<bad>'}];const html=context.renderRejectIn();
 assert.doesNotMatch(html,/<script>|<img |<svg onload/);assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/data-reject-delete|data-reject-ledger=/);assert.match(html,/data-reject-view="table"[^>]*>Tabel</);
});
test('switching mobile views updates existing DOM without rebuilding an editable table',()=>{
 const {context}=fixture();const pressed=[],ledger={dataset:{},querySelectorAll:()=>['compact','table'].map(view=>({dataset:{rejectView:view},setAttribute:(k,v)=>pressed.push([view,k,v])}))};
 context.document.querySelector=()=>ledger;context.setRejectLedgerView('table');assert.equal(ledger.dataset.view,'table');assert.equal(pressed[1][2],'true');
 context.setRejectLedgerView('invalid');assert.equal(ledger.dataset.view,'compact');
});
