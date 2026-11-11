const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
export function netsuiteStockContent(data,sku){
 if(!data?.ready)return {value:'—',note:'Data NetSuite belum terverifikasi. Sinkronkan sumber pada halaman Akurasi Stok.'};
 const row=(data.rows||[]).find(row=>String(row.sku||'').trim().toUpperCase()===String(sku).trim().toUpperCase());
 const raw=row?.stok_netsuite;
 if(raw===null||raw===undefined||raw===''||!Number.isFinite(Number(raw)))return {value:'—',note:'Saldo NetSuite untuk SKU ini belum tersedia.'};
 const sync=(data.sources||[]).find(source=>source.source==='netsuite')?.last_success_at;
 const date=sync?new Date(sync):null;
 return {value:Number(raw).toLocaleString('id-ID'),note:date&&!Number.isNaN(date.getTime())?'Sinkronisasi: '+new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(date):'Saldo akhir dari data NetSuite tersinkron.'};
}
export function mountSkuNetsuiteStock(root,{sku,fetchFn=fetch,isCurrent=()=>true}={}){
 if(!root)return;
 let version=0;
 const current=token=>token===version&&root.isConnected!==false&&isCurrent();
 async function load(){const token=++version;root.setAttribute('aria-busy','true');root.innerHTML='<div class="k">Stok NetSuite</div><div class="v">…</div><small>Memuat saldo NetSuite…</small>';
 try{const response=await fetchFn(`/api/inventory-accuracy?sku=${encodeURIComponent(sku)}`,{cache:'no-store'}),data=await response.json();if(!current(token))return;if(!response.ok||!data?.success)throw Error('Saldo NetSuite belum dapat dimuat.');const stock=netsuiteStockContent(data,sku);root.innerHTML=`<div class="k">Stok NetSuite</div><div class="v">${esc(stock.value)}</div><small>${esc(stock.note)}</small>`;}
 catch{if(current(token)){root.innerHTML='<div class="k">Stok NetSuite</div><div class="v">—</div><small>Gagal memuat saldo NetSuite.</small><button class="btn-ghost" type="button">Coba lagi</button>';root.querySelector('button')?.addEventListener('click',load);}}
 finally{if(current(token))root.setAttribute('aria-busy','false');}
 }
 void load();
 return {refresh:load,dispose(){version++;}};
}
