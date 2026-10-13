const states=new Map();
const keyFor=(account,sku)=>`wms:sku-note-draft:v1:${encodeURIComponent(account)}:${encodeURIComponent(sku)}`;
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
export function formatNoteDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(date)+' WIB';}
export function renderNoteRows(rows){return rows.map(note=>`<article class="sku-note"><div class="sku-note-meta"><strong>${escape(note.author_name)}</strong><span>${escape(note.author_role)}</span><time datetime="${escape(note.created_at)}">${escape(formatNoteDate(note.created_at))}</time></div><p>${escape(note.body)}</p></article>`).join('');}
export function mountSkuNotes(root,{sku,account}){
 if(!root||!account)return;
 sku=String(sku).trim().toUpperCase();const key=keyFor(account,sku);
 let state=states.get(key);
 if(!state){let draft={};try{draft=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
 state={body:typeof draft?.body==='string'?draft.body:'',id:typeof draft?.id==='string'?draft.id:'',rows:[],page:1,hasNext:false,loading:false,saving:false,error:'',success:'',loadId:0,expanded:false,composing:!!draft?.body};states.set(key,state);}
 state.root=root;
 root.innerHTML=`<details class="card sku-notes" data-notes-panel><summary class="sku-notes-heading"><span>Catatan SKU</span><small data-notes-badge></small></summary><div class="sku-notes-content"><div class="sku-notes-actions"><details data-notes-compose><summary>+ Tambah catatan</summary><form data-notes-form><label><span class="sr-only">Catatan baru</span><textarea data-notes-input rows="2" maxlength="2000" placeholder="Tulis catatan…"></textarea></label><div class="row"><button type="submit" class="btn-primary" data-notes-submit>Simpan Catatan</button><small data-notes-count></small></div></form></details><button type="button" class="btn-ghost" data-notes-refresh>Refresh</button></div><p data-notes-status role="status"></p><div class="sku-notes-list" data-notes-list></div><div class="mv-pagination" data-notes-pager><span data-notes-page></span><div class="row"><button type="button" class="btn-ghost" data-notes-prev>Sebelumnya</button><button type="button" class="btn-ghost" data-notes-next>Berikutnya</button></div></div></div></details>`;
 const panel=root.querySelector('[data-notes-panel]'),compose=root.querySelector('[data-notes-compose]');
 panel.open=state.expanded;compose.open=state.composing;
 panel.addEventListener('toggle',()=>{state.expanded=panel.open;});
 compose.addEventListener('toggle',()=>{state.composing=compose.open;});
 const textarea=root.querySelector('[data-notes-input]');textarea.value=state.body;
 const persist=()=>{try{if(state.body)localStorage.setItem(key,JSON.stringify({body:state.body,id:state.id}));else localStorage.removeItem(key);}catch{state.error='Draf belum tersimpan di browser. Jangan tutup halaman sebelum menyimpan catatan.';}};
 const render=()=>{
  const node=state.root;if(!node?.isConnected)return;
  const input=node.querySelector('[data-notes-input]');input.disabled=state.saving;
  const submit=node.querySelector('[data-notes-submit]');submit.disabled=state.saving||!state.body.trim();submit.textContent=state.saving?'Menyimpan…':'Simpan Catatan';
  node.querySelector('[data-notes-count]').textContent=`${state.body.length}/2000`;
  const badge=node.querySelector('[data-notes-badge]');badge.textContent=state.body?'Draf':state.loading&&!state.rows.length?'…':state.rows.length?`${state.rows.length}${state.hasNext?'+':''} di halaman ini`:state.error?'Coba lagi':'Belum ada';
  node.querySelector('[data-notes-pager]').hidden=state.page===1&&!state.hasNext;
  const status=node.querySelector('[data-notes-status]');status.textContent=state.error||state.success||(state.loading?'Memuat catatan…':'');status.className=state.error?'state-error':'';status.hidden=!status.textContent;
  node.querySelector('[data-notes-list]').innerHTML=state.rows.length?renderNoteRows(state.rows):state.loading?'':state.error?'':'<p class="state">Belum ada catatan untuk SKU ini.</p>';
  node.querySelector('[data-notes-page]').textContent=`Halaman ${state.page}`;
  node.querySelector('[data-notes-prev]').disabled=state.loading||state.saving||state.page<=1;
  node.querySelector('[data-notes-next]').disabled=state.loading||state.saving||!state.hasNext;
  node.querySelector('[data-notes-refresh]').disabled=state.loading||state.saving;
 };
 const load=async(page=state.page)=>{
  const id=++state.loadId;state.loading=true;state.error='';render();
  try{const response=await fetch(`/api/sku-notes?sku=${encodeURIComponent(sku)}&page=${page}`,{cache:'no-store'});const data=await response.json();if(id!==state.loadId)return;if(!response.ok||!data.success)throw new Error(data.message||'Catatan gagal dimuat.');state.rows=data.rows;state.page=data.page;state.hasNext=data.hasNext;}
  catch(error){if(id===state.loadId)state.error=error.message||'Catatan gagal dimuat. Gunakan Refresh Catatan untuk mencoba lagi.';}
  finally{if(id===state.loadId){state.loading=false;render();}}
 };
 textarea.addEventListener('input',()=>{state.body=textarea.value;state.id='';state.success='';persist();render();});
 root.querySelector('[data-notes-form]').addEventListener('submit',async event=>{
  event.preventDefault();if(state.saving||!state.body.trim())return;
  if(!state.id)state.id=crypto.randomUUID();persist();state.saving=true;state.error='';state.success='';render();
  try{const response=await fetch('/api/sku-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku,body:state.body,id:state.id})});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.message||'Catatan belum berhasil disimpan.');state.body='';state.id='';persist();state.root?.querySelector('[data-notes-input]')&&(state.root.querySelector('[data-notes-input]').value='');state.composing=false;if(state.root?.isConnected)state.root.querySelector('[data-notes-compose]').open=false;state.success='Catatan tersimpan.';await load(1);}
  catch(error){state.error=error.message||'Penyimpanan belum terkonfirmasi. Teks tetap tersedia untuk dicoba kembali.';}
  finally{state.saving=false;render();}
 });
 root.querySelector('[data-notes-refresh]').addEventListener('click',()=>load());
 root.querySelector('[data-notes-prev]').addEventListener('click',()=>load(Math.max(1,state.page-1)));
 root.querySelector('[data-notes-next]').addEventListener('click',()=>load(state.page+1));
 render();void load();
}
