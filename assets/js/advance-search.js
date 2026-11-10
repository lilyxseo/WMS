import {advanceTable} from './advance-table.js';
export {advanceTable} from './advance-table.js';
import {mountSkuNotes} from './sku-notes.js';
import {mountSkuCatalogPhoto} from './catalog.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const key=value=>String(value??'').trim().toUpperCase();
export const exactSkuRows=(rows,sku)=>(Array.isArray(rows)?rows:[]).filter(row=>key(row.sku)===key(sku));
export async function readAdvanceSection(kind,sku,{request,page=1}={}){
 const encoded=encodeURIComponent(sku);
 if(kind==='detail'){
  const data=await request(`/api/inventory-sku-detail?sku=${encoded}`);
  return Object.entries(data.sources||{}).map(([name,rows])=>({name,rows}));
 }
 if(kind==='reject'){
  const data=await request('/api/barang-reject');
  return {warning:data.warning,groups:[['masuk','Barang Masuk Reject'],['keluar','Barang Keluar Reject']].map(([field,name])=>({name,rows:exactSkuRows(data[field],sku).sort((a,b)=>(Number(a.rowNumber)||0)-(Number(b.rowNumber)||0))}))};
 }
 if(kind==='movement'){const data=await request(`/api/movement?sku=${encoded}`);return exactSkuRows(data.data,sku);}
 if(kind==='cycle'){const data=await request(`/api/cycle-count?sku=${encoded}&page=${page}&limit=50`);return {...data,rows:exactSkuRows(data.rows,sku)};}
 if(kind==='accuracy'){const data=await request(`/api/inventory-accuracy?sku=${encoded}`);if(data.ready!==true)throw Error('Data akurasi stok belum siap.');return exactSkuRows(data.rows,sku);}
 if(['ledger2025','so2025','so2026','trips'].includes(kind)){const data=await request(`/api/advance-search-sources?source=${kind}&sku=${encoded}`);return {groups:data.groups||[],failures:data.failures||[]};}
 throw Error('Sumber tidak dikenal');
}
export function mountAdvanceSearch(root,{fetchFn=(...args)=>fetch(...args),isCurrent=()=>true,account='',confirmDelete}={}){
 if(!root)return null;
 const sources=[['detail','Detail SKU'],['reject','Transaksi Reject'],['movement','History Movement'],['cycle','Cycle Count'],['accuracy','Akurasi Stok'],['ledger2025','Transaksi 2025'],['so2025','Stok Opname 2025'],['so2026','Stok Opname 2026'],['trips','Balikan Store']];
 const sourceStatus=new Map();
 let disposed=false,version=0,searchVersion=0,selectedSku='',notes=null,photo=null,abort=null;
 const alive=()=>!disposed&&root.isConnected&&isCurrent();
 root.innerHTML='<div class="advance-search-card"><div class="advance-search-heading"><span class="advance-eyebrow">PENCARIAN TERPADU</span><h4>Telusuri satu SKU, lihat seluruh riwayatnya.</h4><p id="advanceSearchHint">Stok, transaksi, hasil opname, dan catatan dalam satu halaman.</p></div><form data-advance-form class="search-bar"><label for="advanceQuery">SKU atau nama barang</label><div class="advance-search-controls"><input id="advanceQuery" class="search-lg" type="search" required maxlength="200" placeholder="Ketik SKU atau nama barang…" aria-describedby="advanceSearchHint"><button class="btn-primary" type="submit">Cari data</button></div></form></div><div data-advance-results aria-live="polite" class="advance-results"></div><div data-advance-profile></div>';
 const el=name=>root.querySelector(`[data-advance-${name}]`);
 async function request(url,signal){const response=await fetchFn(url,{cache:'no-store',signal});const data=await response.json();if(!response.ok||data.success===false)throw Error(data.message||'Gagal memuat data.');return data;}
 const groups=items=>items.length?items.map(({name,rows})=>`<details class="source-card advance-source-group" ${rows.length?'open':''}><summary><span>${esc(name)}</span><span class="advance-count">${rows.length} baris</span></summary><div class="source-body">${advanceTable(rows)}</div></details>`).join(''):'<div class="advance-empty-state">Tidak ada data untuk SKU ini.</div>';
 function updateProgress(){
  const loaded=[...sourceStatus.values()].filter(item=>['loaded','partial'].includes(item.status)),failed=[...sourceStatus.values()].filter(item=>['error','partial'].includes(item.status)).length;
  const progress=el('progress');if(progress)progress.textContent=`${loaded.length} dari ${sources.length} sumber siap${failed?` · ${failed} belum lengkap`:''}`;
  for(const [kind]of sources){const state=sourceStatus.get(kind),section=root.querySelector(`[data-advance-section="${kind}"]`),badge=section?.querySelector('[data-source-count]'),jump=root.querySelector(`[data-advance-jump="${kind}"]`);if(!section)continue;section.hidden=!!el('filled')?.checked&&state?.status==='loaded'&&state.count===0;section.setAttribute('aria-busy',String(state?.status==='loading'));if(badge)badge.textContent=['loaded','partial'].includes(state?.status)?`${state.count} baris${state.status==='partial'?' · sebagian':''}`:state?.status==='error'?'Belum tersedia':'Memuat…';if(jump)jump.dataset.state=state?.status||'loading';}
 }
 async function select(sku){
  selectedSku=String(sku||'').trim();if(!selectedSku||!alive())return;
  const token=++version;abort?.abort();abort=new AbortController();const signal=abort.signal;
  notes?.dispose();photo?.dispose();
  sourceStatus.clear();
  el('profile').innerHTML=`<div class="advance-workspace"><header class="advance-profile-header"><div><span class="advance-eyebrow">PROFIL SKU</span><h4>${esc(selectedSku)}</h4><p data-advance-name>Stok dan riwayat dari sumber terhubung</p></div><div class="advance-profile-actions"><span data-advance-photo hidden></span><a class="btn-ghost" href="/sku/${encodeURIComponent(selectedSku)}">Buka Detail SKU</a><button class="btn-ghost" type="button" data-advance-refresh>Perbarui data</button></div></header><div class="advance-status-line"><span data-advance-progress role="status" aria-live="polite">Memuat sumber…</span><label><input type="checkbox" data-advance-filled> Hanya sumber berisi data</label></div><nav class="advance-source-nav" aria-label="Lompat ke sumber data">${sources.map(([kind,name])=>`<button type="button" class="btn-ghost" data-advance-jump="${kind}">${name}</button>`).join('')}</nav>${sources.map(([kind,name])=>`<section class="card advance-source-section" data-advance-section="${kind}"><header class="advance-source-heading"><h4>${name}</h4><span class="advance-count" data-source-count>Memuat…</span></header><div data-advance-body><div class="advance-loading">Memuat data…</div></div></section>`).join('')}<section class="advance-notes" data-advance-notes></section></div>`;
  el('filled').addEventListener('change',updateProgress);
  const current=()=>alive()&&version===token;
  notes=mountSkuNotes(el('notes'),{sku:selectedSku,account,confirmDelete,fetchFn,isCurrent:current});
  photo=mountSkuCatalogPhoto(el('photo'),{sku:selectedSku,fetchFn,fetchImageFn:fetchFn,isCurrent:current});
  for(const kind of ['detail','reject','movement','cycle','accuracy','ledger2025','so2025','so2026','trips'])void load(kind,1,token,signal);
 }
 async function load(kind,page,token,signal){
  const body=root.querySelector(`[data-advance-section="${kind}"] [data-advance-body]`);
  if(!body)return;body.innerHTML='<div class="advance-loading">Memuat data…</div>';sourceStatus.set(kind,{status:'loading'});updateProgress();
  try{
   const data=await readAdvanceSection(kind,selectedSku,{request:url=>request(url,signal),page});
   if(!alive()||token!==version||!body.isConnected)return;
   body.innerHTML=['ledger2025','so2025','so2026','trips'].includes(kind)?`${groups(data.groups)}${data.failures.length?`<div class="state error">Sebagian sumber belum terbaca: ${data.failures.map(item=>esc(item.sheet)+': '+esc(item.message)).join('; ')} <button class="btn-ghost" data-advance-partial-retry>Coba lagi</button></div>`:''}`:kind==='detail'?groups(data):kind==='reject'?`${data.warning?`<p class="state">${esc(data.warning)}</p>`:''}${groups(data.groups)}`:advanceTable(kind==='cycle'?data.rows:data);
   const count=kind==='detail'?data.reduce((n,group)=>n+group.rows.length,0):['reject','ledger2025','so2025','so2026','trips'].includes(kind)?data.groups.reduce((n,group)=>n+group.rows.length,0):kind==='cycle'?Number(data.total)||0:data.length;
   sourceStatus.set(kind,{status:data.failures?.length||data.warning?'partial':'loaded',count});updateProgress();
   if(kind==='detail'){const rows=data.flatMap(group=>group.rows),name=rows.map(row=>row.namaBarang||row.nama_barang||row['Nama Barang']).find(Boolean);if(name&&el('name'))el('name').textContent=name;}
   body.querySelector('[data-advance-partial-retry]')?.addEventListener('click',()=>load(kind,page,token,signal));
   if(kind==='cycle'){
    body.insertAdjacentHTML('beforeend',`<div class="mv-pagination"><span>${data.total} baris · Halaman ${page}</span><button class="btn-ghost" data-advance-prev ${page<=1?'disabled':''}>Sebelumnya</button><button class="btn-ghost" data-advance-next ${page*50>=data.total?'disabled':''}>Berikutnya</button></div>`);
    body.querySelector('[data-advance-prev]').onclick=()=>load(kind,page-1,token,signal);
    body.querySelector('[data-advance-next]').onclick=()=>load(kind,page+1,token,signal);
   }
  }catch(error){if(!alive()||token!==version||!body.isConnected||signal.aborted)return;sourceStatus.set(kind,{status:'error'});updateProgress();body.innerHTML=`<div class="state error advance-error">${esc(error.message)} <button class="btn-ghost" data-advance-retry>Coba lagi</button></div>`;body.querySelector('button').onclick=()=>load(kind,page,token,signal);}
 }
 async function search(event){
  event?.preventDefault();const query=root.querySelector('#advanceQuery').value.trim();if(!query||!alive())return;
  const token=++searchVersion;selectedSku='';el('results').textContent='Mencari…';
  // A complete SKU can be opened even when it exists only in Reject or audit history.
  el('profile').replaceChildren();++version;abort?.abort();notes?.dispose();photo?.dispose();
  try{
   const data=await request('/api/inventory-search?'+new URLSearchParams({q:query}));
   if(!alive()||token!==searchVersion)return;
   const rows=data.rows||[];
   el('results').innerHTML=`<div class="advance-exact-result"><span>Sudah tahu SKU lengkapnya?</span><button type="button" class="btn-ghost" data-advance-sku="${esc(query)}">Buka SKU persis: ${esc(query)}</button></div><div class="advance-result-list">${rows.map(row=>`<button type="button" class="advance-result-option" data-advance-sku="${esc(row.sku)}"><strong>${esc(row.sku)}</strong><span>${esc(row.nama||row.nama_barang||'Nama belum tersedia')}</span><small>Lihat riwayat</small></button>`).join('')}</div>${!rows.length?'<p>Tidak ada hasil pada sumber inventory. Gunakan SKU persis untuk memeriksa riwayat lainnya.</p>':''}`;
  }catch(error){if(!alive()||token!==searchVersion)return;el('results').innerHTML=`<div class="state error">${esc(error.message)} <button class="btn-ghost" data-advance-search-retry>Coba lagi</button></div><button class="btn-primary" data-advance-sku="${esc(query)}">Buka SKU persis: ${esc(query)}</button>`;el('results').querySelector('[data-advance-search-retry]').onclick=()=>search();}
 }
 const profileClick=event=>{if(event.target.closest('[data-advance-refresh]')){void select(selectedSku);return;}const jump=event.target.closest('[data-advance-jump]');if(jump){const target=root.querySelector(`[data-advance-section="${jump.dataset.advanceJump}"]`);if(target?.hidden){el('filled').checked=false;updateProgress();}target?.scrollIntoView({behavior:'smooth',block:'start'});}};root.addEventListener('click',profileClick);
 const click=event=>{const button=event.target.closest('[data-advance-sku]');if(button)void select(button.dataset.advanceSku);};
 el('form').addEventListener('submit',search);el('results').addEventListener('click',click);
 return {refresh:()=>selectedSku?select(selectedSku):search(),dispose(){root.removeEventListener('click',profileClick);disposed=true;++version;++searchVersion;abort?.abort();notes?.dispose();photo?.dispose();el('form')?.removeEventListener('submit',search);el('results')?.removeEventListener('click',click);}};
}
