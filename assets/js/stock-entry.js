export const ENTRY_FIELDS=['tanggal','from','to','sku','namaBarang','qty','status','pic','keterangan'];
const LABELS=['Tanggal','From','To','SKU','Nama barang','Qty','Status','PIC','Keterangan'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function entryNow(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function entryDate(value){
 const raw=String(value).trim();if(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw))return raw.slice(0,10);
 const match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
 return match?`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`:raw;
}
export function newEntry(pic='ABI'){return {tanggal:entryNow(),from:'',to:'',sku:'',namaBarang:'',qty:'',status:'Barang Masuk',pic,keterangan:'RECEIPT',used:false,edited:false};}
export function entryTotals(rows){const used=rows.filter(row=>row.used);return {rows:used.length,sku:new Set(used.map(row=>row.sku.trim()).filter(Boolean)).size,qty:used.reduce((n,row)=>n+(Number(row.qty)||0),0)};}
export function gridDestination(row,col,key,shift=false){
 if(key==='Tab'){let n=row*ENTRY_FIELDS.length+col+(shift?-1:1);return n<0?null:{row:Math.floor(n/ENTRY_FIELDS.length),col:n%ENTRY_FIELDS.length};}
 if(key==='Enter'||key==='ArrowDown')return {row:row+(key==='Enter'&&shift?-1:1),col};
 if(key==='ArrowUp')return row>0?{row:row-1,col}:null;
 if(key==='ArrowLeft')return col>0?{row,col:col-1}:null;
 if(key==='ArrowRight')return col<ENTRY_FIELDS.length-1?{row,col:col+1}:null;
 return null;
}
export function gridJump(rows,row,col,key){
 const dr=key==='ArrowDown'?1:key==='ArrowUp'?-1:0,dc=key==='ArrowRight'?1:key==='ArrowLeft'?-1:0;
 if(!dr&&!dc)return null;
 const inside=(r,c)=>r>=0&&r<rows.length&&c>=0&&c<ENTRY_FIELDS.length;
 const filled=(r,c)=>String(rows[r]?.[ENTRY_FIELDS[c]]??'').trim()!=='';
 let r=row+dr,c=col+dc;if(!inside(r,c))return {row,col};
 if(filled(row,col)&&filled(r,c)){while(inside(r+dr,c+dc)&&filled(r+dr,c+dc)){r+=dr;c+=dc;}}
 else{while(!filled(r,c)&&inside(r+dr,c+dc)){r+=dr;c+=dc;}}
 return {row:r,col:c};
}
export function selectionBounds(selection){return {top:Math.min(selection.anchor.row,selection.active.row),bottom:Math.max(selection.anchor.row,selection.active.row),left:Math.min(selection.anchor.col,selection.active.col),right:Math.max(selection.anchor.col,selection.active.col)};}
export function gridFillPatches(rows,selection,direction){
 const b=selectionBounds(selection),patches=[];
 if(direction==='down'){
  const source=b.top===b.bottom?b.top-1:b.top;if(source<0)return patches;
  for(let row=b.top===b.bottom?b.top:b.top+1;row<=b.bottom;row++)for(let col=b.left;col<=b.right;col++)patches.push({row,col,value:String(rows[source][ENTRY_FIELDS[col]]??'')});
 }else if(direction==='right'){
  const source=b.left===b.right?b.left-1:b.left;if(source<0)return patches;
  for(let row=b.top;row<=b.bottom;row++)for(let col=b.left===b.right?b.left:b.left+1;col<=b.right;col++)patches.push({row,col,value:String(rows[row][ENTRY_FIELDS[source]]??'')});
 }
 return patches;
}
export function mountStockEntry(root,{owner,fetchFn=fetch,confirm,onSaved=()=>{},isCurrent=()=>true}={}){
 const key=`wms:stock-entry:v1:${encodeURIComponent(owner)}`;
 const events=new AbortController();
 const listen=(type,handler,options={})=>root.addEventListener(type,handler,{...(typeof options==='boolean'?{capture:options}:options),signal:events.signal});
 let rows=Array.from({length:20},()=>newEntry()),pending=null,config=null,configLoading=false,message='',storageError=false,busy=false,disposed=false,lookupTimer,lookupController,lookupVersion=0,lookup=null,selection=null,selectionMoving=false;
 const alive=()=>!disposed&&isCurrent();
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved?.version===1&&Array.isArray(saved.rows)&&saved.rows.length<=100){rows=saved.rows.map(row=>row.used===true||row.edited===true?({...newEntry(),...Object.fromEntries(ENTRY_FIELDS.map(f=>[f,String(row?.[f]??'')])),tanggal:row.used===true?entryDate(row.tanggal):entryNow(),used:row.used===true,edited:row.edited===true}):newEntry());while(rows.length<20)rows.push(newEntry());pending=saved.pending||null;}}catch{}
 function persist(){try{localStorage.setItem(key,JSON.stringify({version:1,rows,pending}));storageError=false;return true;}catch{storageError=true;setMessage('Draft tidak dapat disimpan di perangkat. Aktifkan penyimpanan browser sebelum mengirim.');return false;}}
 function setMessage(text){message=text;const el=root.querySelector('[data-entry-message]');if(el)el.textContent=text;}
 function updateTotals(){const total=entryTotals(rows);for(const name of ['rows','sku','qty']){const el=root.querySelector(`[data-entry-total="${name}"]`);if(el)el.textContent=total[name].toLocaleString('id-ID');}const save=root.querySelector('[data-entry-save]');if(save)save.disabled=!config?.canWrite||busy||!!pending||!total.rows;}
 function cell(row,index,col){const field=ENTRY_FIELDS[col],value=row[field],disabled=busy||!!pending||!config?.canWrite;
  const common=`data-entry-cell data-row="${index}" data-col="${col}" aria-label="Baris ${index+1}, ${LABELS[col]}" ${disabled?'disabled':''}`;
  if(['status','pic','keterangan'].includes(field)){const options=field==='status'?(config?.statuses||['Barang Masuk','Barang Keluar']):field==='pic'?(config?.pics||[row.pic]):['RECEIPT','PENGELUARAN'];return `<select ${common}>${!options.includes(value)?`<option selected disabled value="${esc(value)}">${esc(value||'Kosong')} (periksa)</option>`:''}${options.map(v=>`<option ${v===value?'selected':''}>${esc(v)}</option>`).join('')}</select>`;}
  return `<input ${common} type="${field==='tanggal'?'date':'text'}" ${field==='qty'?'inputmode="decimal"':''} value="${esc(value)}"  autocomplete="off" spellcheck="false" ${['sku','namaBarang'].includes(field)?'role="combobox" aria-autocomplete="list" aria-expanded="false"':''}>`;
 }
 function render(){if(!alive())return;closeLookup();root.innerHTML=`<div class="stock-entry-toolbar"><div class="stock-entry-totals"><span>Total SKU<strong data-entry-total="sku">0</strong></span><span>Total qty<strong data-entry-total="qty">0</strong></span><span>Baris diisi<strong data-entry-total="rows">0</strong></span></div><div class="row">${!config?`<button class="btn-ghost" data-entry-config-retry ${configLoading?'disabled':''}>Muat konfigurasi</button>`:''}<button class="btn-ghost" data-entry-add ${busy||pending||!config?.canWrite||rows.length>=100?'disabled':''}>+ 10 baris</button><button class="btn-ghost" data-entry-clear ${busy||pending||!config?.canWrite?'disabled':''}>Kosongkan</button>${pending?'<button class="btn-primary" data-entry-check '+(busy?'disabled':'')+'>Periksa status</button>':'<button class="btn-primary stock-entry-save" data-entry-save>Simpan</button>'}</div></div><p class="subtitle stock-entry-help">Tab / Shift+Tab pindah kolom · Ctrl+panah lompat batas data · Shift+panah pilih rentang · Ctrl+D isi bawah · Ctrl+R isi kanan · ↑ ↓ pindah baris · ← → di ujung teks pindah kolom · Enter turun · Alt+↓ buka dropdown. Paste dari spreadsheet didukung.</p><p class="stock-entry-message" data-entry-message role="status" aria-live="polite">${esc(message||(!config?'Memuat konfigurasi…':!config.canWrite?'Akses baca saja. Hanya PIC atau Developer yang dapat menginput.':pending?'Ada pengiriman yang belum dikonfirmasi. Periksa status sebelum melanjutkan.':'Draft otomatis tersimpan di perangkat. Tanggal menggunakan WIB.'))}</p><div class="stock-entry-scroll"><table class="stock-entry-grid" role="grid" aria-label="Form Input" aria-multiselectable="true"><thead><tr><th scope="col">#</th>${LABELS.map((label,i)=>`<th scope="col" class="entry-col-${ENTRY_FIELDS[i]}">${label}</th>`).join('')}<th scope="col">Aksi</th></tr></thead><tbody>${rows.map((row,i)=>`<tr><th scope="row">${i+1}</th>${ENTRY_FIELDS.map((_,col)=>`<td role="gridcell">${cell(row,i,col)}</td>`).join('')}<td><button class="btn-ghost entry-remove" data-entry-remove="${i}" aria-label="Kosongkan baris ${i+1}" ${busy||pending||!config?.canWrite?'disabled':''}>×</button></td></tr>`).join('')}</tbody></table></div><div class="stock-entry-lookup" data-entry-lookup hidden></div>`;updateTotals();paintSelection();}
 function paintSelection(){
  const bounds=selection?selectionBounds(selection):null;
  root.querySelectorAll('[data-entry-cell]').forEach(input=>{const row=Number(input.dataset.row),col=Number(input.dataset.col),selected=!!bounds&&row>=bounds.top&&row<=bounds.bottom&&col>=bounds.left&&col<=bounds.right;const td=input.closest('td');td.classList.toggle('stock-entry-selected',selected);td.setAttribute('aria-selected',String(selected));});
 }
 function focus(row,col,extend=false,keep=false){
  const input=root.querySelector(`[data-entry-cell][data-row="${row}"][data-col="${col}"]`);if(!input)return;
  const previous=document.activeElement?.closest?.('[data-entry-cell]');
  if(extend){const anchor=selection?.anchor||{row:Number(previous?.dataset.row??row),col:Number(previous?.dataset.col??col)};selection={anchor,active:{row,col}};}
  else if(!keep)selection={anchor:{row,col},active:{row,col}};
  selectionMoving=true;input.focus();selectionMoving=false;if(input.type==='text')input.select();input.scrollIntoView({block:'nearest',inline:'nearest'});paintSelection();
 }
 function fillSelection(input,direction){
  if(!config?.canWrite||busy||pending)return;
  if(!selection)selection={anchor:{row:Number(input.dataset.row),col:Number(input.dataset.col)},active:{row:Number(input.dataset.row),col:Number(input.dataset.col)}};
  const patches=gridFillPatches(rows,selection,direction),used=new Set(rows.flatMap((r,i)=>r.used?[i]:[]));if(!patches.length)return;
  closeLookup();for(const patch of patches)updateField(patch.row,patch.col,patch.value,true);
  for(const row of new Set(patches.map(p=>p.row))){rows[row].used=used.has(row)||['from','to','sku','namaBarang','qty'].some(field=>String(rows[row][field]).trim()!=='');rows[row].edited=true;}
  persist();render();focus(selection.active.row,selection.active.col,false,true);setMessage(direction==='down'?'Rentang diisi ke bawah.':'Rentang diisi ke kanan.');
 }
 function closeLookup(){lookup=null;lookupVersion++;lookupController?.abort();clearTimeout(lookupTimer);const popup=root.querySelector('[data-entry-lookup]');if(popup){popup.hidden=true;popup.innerHTML='';}root.querySelectorAll('[aria-expanded="true"]').forEach(el=>{el.setAttribute('aria-expanded','false');el.removeAttribute('aria-activedescendant');});}
 function updateField(rowIndex,col,value,defer=false){const row=rows[rowIndex],field=ENTRY_FIELDS[col];row[field]=field==='tanggal'?entryDate(value):String(value);row.used=true;if(field==='status'){row.keterangan=value==='Barang Keluar'?'PENGELUARAN':'RECEIPT';const other=root.querySelector(`[data-row="${rowIndex}"][data-col="8"]`);if(other)other.value=row.keterangan;}if(!defer){persist();updateTotals();}}
 function showLookup(input,items){if(!items.length){closeLookup();return;}const box=input.getBoundingClientRect(),popup=root.querySelector('[data-entry-lookup]');lookup={row:Number(input.dataset.row),col:Number(input.dataset.col),items,index:0,input};popup.innerHTML=items.map((item,i)=>`<button type="button" role="option" id="entry-option-${i}" data-entry-option="${i}" aria-selected="${i===0}"><strong>${esc(item.sku)}</strong><span>${esc(item.namaBarang)}</span><small>${esc(item.locations.map(l=>`${l.name} (${l.qty})`).join(' · '))}</small></button>`).join('');popup.setAttribute('role','listbox');popup.id='entry-lookup-list';const width=Math.min(450,window.innerWidth-16);popup.style.left=Math.max(8,Math.min(box.left,window.innerWidth-width-8))+'px';popup.style.top=Math.max(8,Math.min(box.bottom+4,window.innerHeight-240))+'px';popup.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls','entry-lookup-list');input.setAttribute('aria-activedescendant','entry-option-0');}
 async function search(input){closeLookup();const query=input.value.trim();if(query.length<2)return;const version=lookupVersion,row=Number(input.dataset.row),col=Number(input.dataset.col);lookupTimer=setTimeout(async()=>{lookupController=new AbortController();try{const response=await fetchFn('/api/stock-entry?'+new URLSearchParams({q:query}),{signal:lookupController.signal}),data=await response.json();if(!alive()||version!==lookupVersion||document.activeElement!==input||input.value.trim()!==query)return;if(!response.ok||!data.success)throw new Error();const items=data.items||[],field=ENTRY_FIELDS[col],exact=items.filter(item=>String(item[field]).toUpperCase()===query.toUpperCase());if(exact.length===1){applyItem(row,exact[0]);return;}showLookup(input,items);}catch(error){if(error.name!=='AbortError'&&alive()&&version===lookupVersion)setMessage('Pencarian belum dapat dimuat. Ketik ulang SKU atau nama barang untuk mencoba lagi.');}},250);}
 function applyItem(index,item){const row=rows[index];row.sku=item.sku;row.namaBarang=item.namaBarang;row.used=true;for(const col of [3,4]){const input=root.querySelector(`[data-row="${index}"][data-col="${col}"]`);if(input)input.value=row[ENTRY_FIELDS[col]];}persist();updateTotals();closeLookup();}
 function choose(){if(!lookup)return;const {row,index,items}=lookup;applyItem(row,items[index]);focus(row,5);}
 listen('input',event=>{const input=event.target.closest('[data-entry-cell]');if(!input||busy||pending)return;const point={row:Number(input.dataset.row),col:Number(input.dataset.col)};selection={anchor:point,active:point};paintSelection();updateField(Number(input.dataset.row),Number(input.dataset.col),input.value);if([3,4].includes(Number(input.dataset.col)))void search(input);});
 listen('change',event=>{const input=event.target.closest('select[data-entry-cell]');if(input&&!busy&&!pending)updateField(Number(input.dataset.row),Number(input.dataset.col),input.value);});
 async function resolveExact(input){
  const index=Number(input.dataset.row),col=Number(input.dataset.col),row=rows[index],field=ENTRY_FIELDS[col],value=row[field].trim();if(value.length<2||busy||pending)return;
  try{const response=await fetchFn('/api/stock-entry?'+new URLSearchParams({q:value})),data=await response.json();if(!alive()||!response.ok||!data.success||rows[index]!==row||row[field].trim()!==value||busy||pending)return;const exact=(data.items||[]).filter(item=>String(item[field]).toUpperCase()===value.toUpperCase());if(exact.length!==1)return;const item=exact[0];if(field==='sku'&&row.namaBarang&&row.namaBarang!==item.namaBarang)return;row.sku=item.sku;row.namaBarang=item.namaBarang;for(const c of [3,4]){const el=root.querySelector(`[data-row="${index}"][data-col="${c}"]`);if(el)el.value=row[ENTRY_FIELDS[c]];}persist();updateTotals();}catch{}
 }
 listen('focusout',event=>{const input=event.target.closest('[data-entry-cell]');if(input&&[3,4].includes(Number(input.dataset.col)))void resolveExact(input);});
 listen('focusin',event=>{const input=event.target.closest('[data-entry-cell]');if(input&&!selectionMoving){const point={row:Number(input.dataset.row),col:Number(input.dataset.col)};selection={anchor:point,active:point};paintSelection();}if(lookup&&event.target!==lookup.input&&!event.target.closest('[data-entry-lookup]'))closeLookup();});
 listen('keydown',event=>{
  const input=event.target.closest('[data-entry-cell]');if(!input||event.isComposing||busy||pending)return;
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&['d','r'].includes(event.key.toLowerCase())){event.preventDefault();fillSelection(input,event.key.toLowerCase()==='d'?'down':'right');return;}
  if(event.shiftKey&&!event.altKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const dest=(event.ctrlKey||event.metaKey)?gridJump(rows,Number(input.dataset.row),Number(input.dataset.col),event.key):gridDestination(Number(input.dataset.row),Number(input.dataset.col),event.key);if(dest&&dest.row>=0&&dest.row<rows.length){closeLookup();focus(dest.row,dest.col,true);}return;}
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){const dest=gridJump(rows,Number(input.dataset.row),Number(input.dataset.col),event.key);if(dest){event.preventDefault();closeLookup();focus(dest.row,dest.col);}return;}
  if(lookup&&['ArrowUp','ArrowDown','Enter','Escape'].includes(event.key)){
   event.preventDefault();if(event.key==='Escape')return closeLookup();if(event.key==='Enter')return choose();lookup.index=(lookup.index+(event.key==='ArrowDown'?1:-1)+lookup.items.length)%lookup.items.length;root.querySelectorAll('[data-entry-option]').forEach((el,i)=>el.setAttribute('aria-selected',String(i===lookup.index)));input.setAttribute('aria-activedescendant',`entry-option-${lookup.index}`);return;
  }
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.shiftKey&&!['Tab','Enter'].includes(event.key))return;
  if(input.type==='text'&&['ArrowLeft','ArrowRight'].includes(event.key)){const all=input.selectionStart===0&&input.selectionEnd===input.value.length;if(!all&&(event.key==='ArrowLeft'?input.selectionStart>0:input.selectionEnd<input.value.length))return;}
  const dest=gridDestination(Number(input.dataset.row),Number(input.dataset.col),event.key,event.shiftKey);if(!dest||dest.row<0||dest.row>=100)return;
  event.preventDefault();closeLookup();if(dest.row>=rows.length){rows.push(newEntry(config.pic));persist();render();}focus(dest.row,dest.col);
 });
 listen('copy',event=>{if(!selection||!event.target.closest('[data-entry-cell]'))return;const b=selectionBounds(selection);if(b.top===b.bottom&&b.left===b.right)return;event.preventDefault();event.clipboardData.setData('text/plain',rows.slice(b.top,b.bottom+1).map(row=>ENTRY_FIELDS.slice(b.left,b.right+1).map(field=>row[field]).join('\t')).join('\n'));});
 listen('paste',event=>{
  const input=event.target.closest('[data-entry-cell]');if(!input||busy||pending||!config?.canWrite)return;const text=event.clipboardData.getData('text/plain');if(!/[\t\n\r]/.test(text))return;event.preventDefault();const block=text.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(line=>line.split('\t')),startRow=Number(input.dataset.row),startCol=Number(input.dataset.col);if(startRow+block.length>100){setMessage('Maksimal 100 baris per input. Paste dibatalkan.');return;}
  while(rows.length<startRow+block.length)rows.push(newEntry(config.pic));block.forEach((line,i)=>line.slice(0,ENTRY_FIELDS.length-startCol).forEach((value,j)=>updateField(startRow+i,startCol+j,value,true)));persist();render();focus(startRow,startCol);setMessage(`${block.length} baris ditempel. Periksa SKU, Nama barang, dan Status sebelum menyimpan.`);
 });
 listen('mousedown',event=>{if(event.target.closest('[data-entry-option]')){event.preventDefault();return;}const input=event.target.closest('[data-entry-cell]');if(input){const row=Number(input.dataset.row),col=Number(input.dataset.col);if(event.shiftKey&&selection){event.preventDefault();focus(row,col,true);}else{selection={anchor:{row,col},active:{row,col}};paintSelection();}}});
 listen('click',event=>{
  if(event.target.closest('[data-entry-config-retry]'))return void loadConfig();
  const option=event.target.closest('[data-entry-option]');if(option&&lookup){lookup.index=Number(option.dataset.entryOption);choose();return;}
  if(event.target.closest('[data-entry-save]'))return review();
  if(event.target.closest('[data-entry-check]'))return void check();
  if(busy||pending||!config?.canWrite)return;
  if(event.target.closest('[data-entry-add]')){const target=Math.min(100,rows.length+10);while(rows.length<target)rows.push(newEntry(config.pic));persist();render();return;}
  const remove=event.target.closest('[data-entry-remove]');if(remove){const index=Number(remove.dataset.entryRemove);rows[index]=newEntry(config.pic);persist();render();focus(index,3);return;}
  if(event.target.closest('[data-entry-clear]'))confirm({title:'Kosongkan form?',message:'Hapus seluruh draft input di perangkat ini?',confirmText:'Kosongkan',cancelText:'Batal',onConfirm:()=>{if(busy||pending||!alive())return;rows=Array.from({length:20},()=>newEntry(config.pic));persist();render();}});
 });
 function entries(){return rows.filter(row=>row.used).map(row=>Object.fromEntries(ENTRY_FIELDS.map(field=>[field,field==='qty'?Number(row[field]):String(row[field]).trim()])));}
 function review(){if(!config?.canWrite||busy||pending)return;const list=entries();if(!list.length)return;for(let i=0;i<rows.length;i++){const row=rows[i];if(!row.used)continue;const invalid=!row.tanggal?0:!row.from.trim()?1:!row.to.trim()?2:!row.sku.trim()?3:!row.namaBarang.trim()?4:!Number.isFinite(Number(row.qty))||Number(row.qty)<=0?5:row.keterangan!==(row.status==='Barang Masuk'?'RECEIPT':'PENGELUARAN')?8:-1;if(invalid>=0){setMessage(`Baris ${i+1}: periksa ${LABELS[invalid]}.`);focus(i,invalid);return;}}
  const total=entryTotals(rows),inCount=list.filter(row=>row.status==='Barang Masuk').length;
  confirm({title:'Simpan transaksi?',message:`${list.length} baris • ${total.sku} SKU • ${total.qty.toLocaleString('id-ID')} qty. Barang Masuk: ${inCount}; Barang Keluar: ${list.length-inCount}. Data akan dipindahkan ke ledger sesuai Status.`,confirmText:'Simpan',cancelText:'Kembali',onConfirm:()=>{if(alive()&&!busy&&!pending)void send();}});
 }
 async function complete(data){pending=null;rows=Array.from({length:20},()=>newEntry(config?.pic));persist();message=`Berhasil menyimpan ${data.result.count} baris (${data.result.qty.toLocaleString('id-ID')} qty).`;render();const savedMessage=message;void Promise.resolve(onSaved(data)).catch(()=>{if(alive()&&!pending&&message===savedMessage)setMessage(savedMessage+' Penyegaran WMS belum selesai; ledger sudah tersimpan.');});}
 async function send(){if(!alive()||busy||pending)return;pending={id:crypto.randomUUID(),entries:entries()};if(!persist()){pending=null;return;}busy=true;closeLookup();render();setMessage('Menyimpan transaksi…');try{const response=await fetchFn('/api/stock-entry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)}),data=await response.json();if(!alive())return;if(response.ok&&data.success){await complete(data);return;}if(data.retryable){pending=null;persist();}setMessage(data.message||'Penyimpanan belum terkonfirmasi. Gunakan Periksa status.');}catch{if(alive())setMessage('Koneksi terputus. Gunakan Periksa status sebelum mencoba lagi.');}finally{if(alive()){busy=false;render();}}}
 async function check(){if(!alive()||busy||!pending)return;busy=true;render();setMessage('Memeriksa status…');try{const response=await fetchFn('/api/stock-entry?id='+encodeURIComponent(pending.id)),data=await response.json();if(!alive())return;if(response.ok&&data.success){await complete(data);return;}if(data.retryable){pending=null;persist();}setMessage(data.message||'Status belum dapat dikonfirmasi. Coba periksa kembali.');}catch{if(alive())setMessage('Status belum dapat diperiksa. Draft tetap disimpan.');}finally{if(alive()){busy=false;render();}}}
 const onScroll=event=>{if(event?.target?.closest?.('[data-entry-lookup]'))return;closeLookup();};window.addEventListener('resize',onScroll);listen('scroll',onScroll,true);
 async function loadConfig(){if(configLoading||!alive())return;configLoading=true;render();try{const response=await fetchFn('/api/stock-entry'),data=await response.json();if(!alive())return;if(!response.ok||!data.success)throw new Error();config=data;rows.forEach(row=>{if(!row.used&&!row.edited)row.pic=data.pic;});message='';}catch{if(alive())message='Konfigurasi belum dapat dimuat. Gunakan Muat konfigurasi untuk mencoba kembali.';}finally{configLoading=false;if(alive())render();}}
 render();void loadConfig();
 return {snapshot:()=>({rows,pending}),dispose(){disposed=true;events.abort();closeLookup();window.removeEventListener('resize',onScroll);}};
}
