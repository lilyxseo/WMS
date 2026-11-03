import {mountSkuNotes} from './sku-notes.js';
import {mountSkuCatalogPhoto} from './catalog.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const key=value=>String(value??'').trim().toUpperCase();
export const exactSkuRows=(rows,sku)=>(Array.isArray(rows)?rows:[]).filter(row=>key(row.sku)===key(sku));
export function advanceTable(rows){
 if(!rows.length)return '<div class="state">Tidak ada data untuk SKU ini.</div>';
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
 return `<div class="table-wrap"><table><thead><tr>${columns.map(column=>`<th>${esc(column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(column=>`<td>${esc(typeof row[column]==='object'?JSON.stringify(row[column]):row[column])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="subtitle">${rows.length} baris</p>`;
}
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
 throw Error('Sumber tidak dikenal');
}
export function mountAdvanceSearch(root,{fetchFn=(...args)=>fetch(...args),isCurrent=()=>true,account='',confirmDelete}={}){
 if(!root)return null;
 let disposed=false,version=0,searchVersion=0,selectedSku='',notes=null,photo=null,abort=null;
 const alive=()=>!disposed&&root.isConnected&&isCurrent();
 root.innerHTML='<form data-advance-form class="search-bar"><label for="advanceQuery">SKU atau nama barang</label><input id="advanceQuery" class="search-lg" type="search" required maxlength="200" placeholder="Masukkan SKU lengkap atau cari nama barang"><button class="btn-primary" type="submit">Cari</button></form><div data-advance-results aria-live="polite"></div><div data-advance-profile></div>';
 const el=name=>root.querySelector(`[data-advance-${name}]`);
 async function request(url,signal){const response=await fetchFn(url,{cache:'no-store',signal});const data=await response.json();if(!response.ok||data.success===false)throw Error(data.message||'Gagal memuat data.');return data;}
 const groups=items=>items.map(({name,rows})=>`<details class="source-card" open><summary>${esc(name)} · ${rows.length} baris</summary><div class="source-body">${advanceTable(rows)}</div></details>`).join('');
 async function select(sku){
  selectedSku=String(sku||'').trim();if(!selectedSku||!alive())return;
  const token=++version;abort?.abort();abort=new AbortController();const signal=abort.signal;
  notes?.dispose();photo?.dispose();
  el('profile').innerHTML=`<div class="detail-profile"><header class="detail-hero"><h4>SKU: ${esc(selectedSku)}</h4><a href="/sku/${encodeURIComponent(selectedSku)}">Buka Detail SKU</a><span data-advance-photo hidden></span></header>${[['detail','Detail SKU'],['reject','Transaksi Reject'],['movement','History Movement'],['cycle','Cycle Count'],['accuracy','Akurasi Stok']].map(([kind,name])=>`<section class="card" data-advance-section="${kind}"><h4>${name}</h4><div data-advance-body role="status">Memuat…</div></section>`).join('')}<section data-advance-notes></section></div>`;
  const current=()=>alive()&&version===token;
  notes=mountSkuNotes(el('notes'),{sku:selectedSku,account,confirmDelete,fetchFn,isCurrent:current});
  photo=mountSkuCatalogPhoto(el('photo'),{sku:selectedSku,fetchFn,fetchImageFn:fetchFn,isCurrent:current});
  for(const kind of ['detail','reject','movement','cycle','accuracy'])void load(kind,1,token,signal);
 }
 async function load(kind,page,token,signal){
  const body=root.querySelector(`[data-advance-section="${kind}"] [data-advance-body]`);
  if(!body)return;body.textContent='Memuat…';
  try{
   const data=await readAdvanceSection(kind,selectedSku,{request:url=>request(url,signal),page});
   if(!alive()||token!==version||!body.isConnected)return;
   body.innerHTML=kind==='detail'?groups(data):kind==='reject'?`${data.warning?`<p class="state">${esc(data.warning)}</p>`:''}${groups(data.groups)}`:advanceTable(kind==='cycle'?data.rows:data);
   if(kind==='cycle'){
    body.insertAdjacentHTML('beforeend',`<div class="mv-pagination"><span>${data.total} baris · Halaman ${page}</span><button class="btn-ghost" data-advance-prev ${page<=1?'disabled':''}>Sebelumnya</button><button class="btn-ghost" data-advance-next ${page*50>=data.total?'disabled':''}>Berikutnya</button></div>`);
    body.querySelector('[data-advance-prev]').onclick=()=>load(kind,page-1,token,signal);
    body.querySelector('[data-advance-next]').onclick=()=>load(kind,page+1,token,signal);
   }
  }catch(error){if(!alive()||token!==version||!body.isConnected||signal.aborted)return;body.innerHTML=`<div class="state error">${esc(error.message)} <button class="btn-ghost" data-advance-retry>Coba lagi</button></div>`;body.querySelector('button').onclick=()=>load(kind,page,token,signal);}
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
   el('results').innerHTML=`<p><button class="btn-primary" data-advance-sku="${esc(query)}">Buka SKU persis: ${esc(query)}</button></p>${rows.map(row=>`<button class="btn-ghost" data-advance-sku="${esc(row.sku)}">${esc(row.sku)} · ${esc(row.nama||row.nama_barang||'')}</button>`).join('')}${!rows.length?'<p>Tidak ada hasil pada sumber inventory. Gunakan SKU persis untuk memeriksa riwayat lainnya.</p>':''}`;
  }catch(error){if(!alive()||token!==searchVersion)return;el('results').innerHTML=`<div class="state error">${esc(error.message)} <button class="btn-ghost" data-advance-search-retry>Coba lagi</button></div><button class="btn-primary" data-advance-sku="${esc(query)}">Buka SKU persis: ${esc(query)}</button>`;el('results').querySelector('[data-advance-search-retry]').onclick=()=>search();}
 }
 const click=event=>{const button=event.target.closest('[data-advance-sku]');if(button)void select(button.dataset.advanceSku);};
 el('form').addEventListener('submit',search);el('results').addEventListener('click',click);
 return {refresh:()=>selectedSku?select(selectedSku):search(),dispose(){disposed=true;++version;++searchVersion;abort?.abort();notes?.dispose();photo?.dispose();el('form')?.removeEventListener('submit',search);el('results')?.removeEventListener('click',click);}};
}
