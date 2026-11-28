const fmt = new Intl.NumberFormat('id-ID');
const dayFormat = new Intl.DateTimeFormat('id-ID',{dateStyle:'long',timeZone:'UTC'});
const captureFormat = new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'});
const escape = value => String(value??'—').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const datasets = {stock:'Kartu Stok',rpl:'RPL',bulky:'BULKY',inbound:'Barang Masuk',outbound:'Barang Keluar'};
const stockFields=[['SKU','sku'],['Nama barang','name'],['Lokasi','location'],['Stok akhir','qty'],['Sumber','source']];
const transactionFields=[['Tanggal','date'],['SKU','sku'],['Nama barang','name'],['From','from'],['To','to'],['Qty','qty'],['Status','status'],['PIC','pic'],['Keterangan','note']];

export function mountInventoryHistory(root,{read}){
  let kind='stock',page=1,controller,changes;
  root.innerHTML=`<header class="inventory-history-heading">
   <h1>Riwayat Gudang</h1>
   <p>Lihat stok dan transaksi dari versi Google Sheets pada tanggal pilihan.</p>
  </header>
  <div class="inventory-history-workspace">
   <div class="inventory-history-controls">
    <label>Tanggal riwayat <input type="date" data-history-date></label>
    <button type="button" class="btn-ghost" data-history-latest>Hari ini</button>
    <label>Cari data <input type="search" maxlength="120" placeholder="SKU, nama barang, atau lokasi…" data-history-search></label>
   </div>
   <div class="inventory-history-tabs" role="group" aria-label="Jenis data">${Object.entries(datasets).map(([key,label])=>`<button type="button" class="btn-ghost" data-kind="${key}" aria-pressed="${key===kind}">${label}</button>`).join('')}</div>
  </div>
  <section class="inventory-history-results" aria-labelledby="inventory-history-source-title">
   <header class="inventory-history-results-header">
    <div><h2 id="inventory-history-source-title" data-history-title>Kartu Stok</h2><p class="inventory-history-feedback" role="status" data-history-status></p></div>
    <div class="inventory-history-version" data-history-version hidden>
     <span>Versi Google Sheets</span>
     <time data-history-version-time></time>
    </div>
   </header>
   <div class="inventory-history-content" data-history-content aria-busy="true"></div>
  </section>
  <footer class="inventory-history-pager" data-history-pager hidden>
   <span data-history-count></span>
   <button type="button" class="btn-ghost" data-history-prev>Sebelumnya</button>
   <button type="button" class="btn-ghost" data-history-next>Berikutnya</button>
  </footer>`;
  const el=name=>root.querySelector(`[data-history-${name}]`);
  const date=el('date'),search=el('search');
  let latestDate=null;

  function render(data){
    latestDate=data.latestDate;
    date.value=data.date||'';
    if(data.latestDate)date.max=data.latestDate;
    el('latest').disabled=!data.latestDate||data.date===data.latestDate;
    const isStock=kind!=='inbound'&&kind!=='outbound';
    const day=dayFormat.format(new Date(data.date+'T00:00:00Z'));
    if(data.revisionUnavailable){
      el('status').textContent=`Tanggal pilihan ${day} WIB`;
      const notice=document.createElement('div');
      notice.className='inventory-history-empty';
      notice.textContent=data.message||'Riwayat versi tidak tersedia.';
      el('content').append(notice);
      return;
    }
    page=data.page;
    el('status').textContent=`Tanggal pilihan ${day} WIB · ${fmt.format(data.total)} baris`;
    const versionTime=el('version-time');
    versionTime.dateTime=data.revisionAt;
    versionTime.textContent=`${captureFormat.format(new Date(data.revisionAt))} WIB`;
    el('version').hidden=false;
    if(!data.rows.length){
      el('content').insertAdjacentHTML('beforeend','<div class="inventory-history-empty">Tidak ada data yang cocok.</div>');
      return;
    }
    const fields=isStock?stockFields:transactionFields;
    el('content').insertAdjacentHTML('beforeend',`<div class="inventory-history-table table-wrap" tabindex="0" role="region" aria-label="${datasets[kind]}"><table role="table">
     <thead role="rowgroup"><tr role="row">${fields.map(([label,field])=>`<th role="columnheader" scope="col" class="${field==='qty'?'history-qty':''}">${label}</th>`).join('')}</tr></thead>
     <tbody role="rowgroup">${data.rows.map(row=>`<tr role="row">${fields.map(([label,field])=>`<td role="cell" data-label="${label}" data-field="${field}" class="${field==='qty'?'history-qty':''}">${field==='qty'&&typeof row.qty==='number'?fmt.format(row.qty):escape(row[field]===''?'—':row[field])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`);
    const first=(page-1)*50+1,last=first+data.rows.length-1;
    el('count').textContent=`${fmt.format(first)}–${fmt.format(last)} dari ${fmt.format(data.total)} baris`;
    el('pager').hidden=false;
    el('prev').disabled=page<=1;
    el('next').disabled=last>=data.total;
  }

  async function load(){
    clearTimeout(changes);
    controller?.abort();
    const request=new AbortController();
    controller=request;
    const params=new URLSearchParams({kind,page,q:search.value.trim()});
    if(date.value)params.set('date',date.value);
    el('title').textContent=datasets[kind];
    el('version').hidden=true;
    el('status').textContent='Memuat riwayat gudang…';
    el('content').replaceChildren();
    el('content').setAttribute('aria-busy','true');
    el('pager').hidden=true;
    try{
      const data=await read(params,request.signal);
      if(!request.signal.aborted)render(data);
    }catch(error){
      if(!request.signal.aborted){
        el('status').textContent=error.message||'Gagal memuat riwayat gudang.';
        const retry=document.createElement('button');
        retry.type='button';
        retry.className='btn-ghost';
        retry.textContent='Coba lagi';
        retry.onclick=load;
        el('content').append(retry);
      }
    }finally{
      if(!request.signal.aborted)el('content').setAttribute('aria-busy','false');
    }
  }

  date.onchange=()=>{page=1;void load();};
  el('latest').onclick=()=>{if(latestDate)date.value='';page=1;void load();};
  search.oninput=()=>{
    clearTimeout(changes);
    controller?.abort();
    page=1;
    changes=setTimeout(load,250);
  };
  const tabs=[...root.querySelectorAll('[data-kind]')];
  for(const button of tabs)button.onclick=()=>{
    kind=button.dataset.kind;
    page=1;
    for(const tab of tabs)tab.setAttribute('aria-pressed',String(tab===button));
    void load();
  };
  el('prev').onclick=()=>{page--;void load();};
  el('next').onclick=()=>{page++;void load();};
  void load();
  return {dispose(){clearTimeout(changes);controller?.abort();root.replaceChildren();}};
}
