import {renderNoteRows} from './sku-notes.js';
const mounted=new WeakMap();
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
export function mountAllSkuNotes(root,{account,confirmDelete,navigate}){
 if(!root||!account)return null;
 const previous=mounted.get(root);if(previous?.account===account)return previous;
 previous?.dispose();
 const state={rows:[],page:1,total:null,hasNext:false,query:'',mine:false,loading:false,deleting:'',error:'',requestId:0};
 let disposed=false,timer,controller;
 root.innerHTML=`<div class="card all-sku-notes"><div class="all-notes-toolbar"><input class="search-lg" data-all-notes-search maxlength="150" placeholder="Cari SKU, catatan, penulis, atau role" aria-label="Cari catatan"><select data-all-notes-owner aria-label="Filter penulis"><option value="all">Semua penulis</option><option value="mine">Catatan saya</option></select><button type="button" class="btn-ghost" data-all-notes-refresh>Refresh</button></div><p data-all-notes-status role="status"></p><div data-all-notes-list></div><div class="mv-pagination"><span data-all-notes-page></span><div class="row"><button type="button" class="btn-ghost" data-all-notes-prev>Sebelumnya</button><button type="button" class="btn-ghost" data-all-notes-next>Berikutnya</button></div></div></div>`;
 const render=()=>{
  if(disposed||!root.isConnected)return;
  const status=root.querySelector('[data-all-notes-status]');status.textContent=state.error||(state.loading?'Memuat catatan…':'');status.hidden=!status.textContent;status.className=state.error?'state-error':'';
  const list=root.querySelector('[data-all-notes-list]');
  list.innerHTML=state.rows.length?state.rows.map(note=>`<div class="all-notes-entry"><a class="all-notes-sku" href="/sku/${encodeURIComponent(note.sku)}" data-all-note-sku="${escape(note.sku)}">SKU ${escape(note.sku)}</a>${renderNoteRows([note],{disabled:state.loading||!!state.deleting,deletingId:state.deleting})}</div>`).join(''):state.loading||state.error?'':'<p class="state">Tidak ada catatan ditemukan.</p>';
  const start=state.rows.length?(state.page-1)*20+1:0,end=state.rows.length?(state.page-1)*20+state.rows.length:0;
  root.querySelector('[data-all-notes-page]').textContent=`${start}–${end}${state.total===null?'':` dari ${state.total} catatan`} • Halaman ${state.page}${state.total===null?'':`/${Math.max(1,Math.ceil(state.total/20))}`}`;
  root.querySelector('[data-all-notes-prev]').disabled=state.loading||!!state.deleting||state.page<=1;
  root.querySelector('[data-all-notes-next]').disabled=state.loading||!!state.deleting||!state.hasNext;
  root.querySelector('[data-all-notes-refresh]').disabled=state.loading||!!state.deleting;
  root.querySelector('[data-all-notes-search]').disabled=!!state.deleting;
  root.querySelector('[data-all-notes-owner]').disabled=!!state.deleting;
 };
 const load=async(page=state.page)=>{
  if(disposed)return;clearTimeout(timer);controller?.abort();controller=new AbortController();const id=++state.requestId;
  const params=new URLSearchParams({all:'1',page:String(page)});if(state.query)params.set('q',state.query);if(state.mine)params.set('mine','1');
  state.loading=true;state.error='';render();
  try{const response=await fetch(`/api/sku-notes?${params}`,{cache:'no-store',signal:controller.signal});const data=await response.json();if(disposed||id!==state.requestId)return;if(!response.ok||!data.success)throw new Error(data.message||'Catatan gagal dimuat.');Object.assign(state,{rows:data.rows,page:data.page,total:Number.isFinite(data.total)?data.total:null,hasNext:data.hasNext});}
  catch(error){if(!disposed&&id===state.requestId&&error.name!=='AbortError')state.error=error.message||'Catatan gagal dimuat. Coba Refresh.';}
  finally{if(!disposed&&id===state.requestId){state.loading=false;render();}}
 };
 root.querySelector('[data-all-notes-search]').addEventListener('input',event=>{state.query=event.target.value.trim();clearTimeout(timer);controller?.abort();++state.requestId;state.loading=true;state.error='';render();timer=setTimeout(()=>load(1),300);});
 root.querySelector('[data-all-notes-owner]').addEventListener('change',event=>{state.mine=event.target.value==='mine';void load(1);});
 root.querySelector('[data-all-notes-refresh]').addEventListener('click',()=>load());
 root.querySelector('[data-all-notes-prev]').addEventListener('click',()=>load(Math.max(1,state.page-1)));
 root.querySelector('[data-all-notes-next]').addEventListener('click',()=>load(state.page+1));
 root.querySelector('[data-all-notes-list]').addEventListener('click',event=>{
  const link=event.target?.closest('[data-all-note-sku]');if(link){if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;if(typeof navigate==='function'){event.preventDefault();navigate(link.dataset.allNoteSku);}return;}
  const button=event.target?.closest('[data-note-delete]');if(!button||state.loading||state.deleting)return;
  const note=state.rows.find(row=>row.id===button.dataset.noteDelete&&row.canDelete===true);if(!note||typeof confirmDelete!=='function')return;
  confirmDelete({title:'Hapus Catatan',message:`Hapus catatan Anda untuk SKU ${note.sku}?`,confirmText:'Hapus',cancelText:'Kembali',type:'danger',onConfirm:async()=>{
   if(disposed||state.deleting||!state.rows.some(row=>row.id===note.id&&row.canDelete===true))return;
   clearTimeout(timer);controller?.abort();++state.requestId;state.loading=false;state.deleting=note.id;state.error='';render();
   try{const response=await fetch('/api/sku-notes',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:note.sku,id:note.id})});const data=await response.json();if(disposed)return;if(!response.ok||!data.success)throw new Error(data.message||'Penghapusan belum terkonfirmasi. Refresh Catatan sebelum mencoba lagi.');state.rows=state.rows.filter(row=>row.id!==note.id);await load(1);}
   catch(error){if(!disposed)state.error=error.message||'Penghapusan belum terkonfirmasi. Refresh Catatan sebelum mencoba lagi.';}
   finally{state.deleting='';render();}
  }});
 });
 const api={account,refresh:()=>state.deleting?Promise.resolve():load(),dispose:()=>{disposed=true;clearTimeout(timer);controller?.abort();}};
 mounted.set(root,api);render();void load();return api;
}
