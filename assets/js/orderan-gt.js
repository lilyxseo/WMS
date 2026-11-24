const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = new Intl.NumberFormat('id-ID');
const date = new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'});
const qty = value => value == null ? '—' : number.format(value);
const cell = value => escape(value || '—');
const PAGE_SIZE = 15;

export function filterGtOrders(orders, view, search, {status='', pickingStatus=''}={}) {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return orders.filter(order => {
    if (view === 'active' && !order.active) return false;
    if ((status || pickingStatus) && !order.items.some(item =>
      (!status || item.status === status) && (!pickingStatus || item.pickingStatus === pickingStatus)
    )) return false;
    const haystack = [order.customer,...order.items.flatMap(item => [item.sku,item.product,item.status,item.pickingStatus,item.payment])].join(' ').toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
export function gtOrderStatusCounts(orders) {
  const counts = new Map();
  for (const order of orders) {
    const statuses = new Set(order.items.map(item=>item.status).filter(Boolean));
    for (const status of statuses) counts.set(status,(counts.get(status)??0)+1);
  }
  return [...counts].sort(([left],[right])=>left.localeCompare(right,'id'));
}
function orderMarkup(order) {
  const statuses = [...new Set(order.items.map(item => item.status).filter(Boolean))];
  const skus = [...new Set(order.items.map(item => item.sku).filter(Boolean))];
  const totalQty = field => order.items.some(item=>item[field] != null)
    ? order.items.reduce((total,item)=>total+(item[field] ?? 0),0)
    : null;
  const requested = totalQty('requested'), picked = totalQty('picked');
  const progress = requested > 0 && order.items.every(item=>item.requested != null && item.picked != null)
    ? Math.max(0,Math.min(requested,picked))
    : null;
  const fields = [
    ['Nama produk','product'],['Qty request','requested',qty],['Qty picking','picked',qty],
    ['Status','status'],['Payment','payment'],['Status picking','pickingStatus'],
    ['Bulky','bulky',qty],['Retail','retail',qty],['Ket','note'],['Remark','remark']
  ];
  return `<details class="gt-order" data-gt-row="${order.row}">
    <summary>
      <div class="gt-order-summary">
        <strong>${escape(order.customer || 'Customer belum tercatat')}</strong>
        <small>Baris ${number.format(order.row)} · ${number.format(order.items.length)} item · ${number.format(skus.length)} SKU</small>
        <small>Qty request ${qty(requested)} · Qty picking ${qty(picked)}</small>
        ${progress === null ? '' : `<progress class="gt-progress" max="${requested}" value="${progress}" aria-label="Progres picking"></progress>`}
      </div>
      <div class="gt-order-status">
        ${(statuses.length ? statuses : ['Status belum diisi']).map(status => `<span class="gt-badge">${escape(status)}</span>`).join('')}
      </div>
    </summary>
    <div class="gt-table" tabindex="0" role="region" aria-label="Item order baris ${order.row}">
      <table role="table"><thead role="rowgroup"><tr role="row">${['SKU',...fields.map(([label])=>label)].map(label=>`<th scope="col" role="columnheader">${label}</th>`).join('')}</tr></thead>
      <tbody role="rowgroup">${order.items.map(item => `<tr role="row">
        <td role="cell" class="gt-sku" data-label="SKU">${item.sku ? `<a href="/sku/${encodeURIComponent(item.sku)}">${escape(item.sku)}</a>` : '<span class="gt-badge gt-badge-warning">SKU kosong</span>'}</td>
        ${fields.map(([label,key,format=cell])=>`<td role="cell" data-label="${label}">${format(item[key])}</td>`).join('')}
      </tr>`).join('')}</tbody></table>
    </div>
  </details>`;
}

export function mountGtOrders(root, {read}) {
  let orders = [], view = 'active', page = 1, controller, loaded = false;
  root.innerHTML = `<header class="gt-heading">
    <div class="gt-heading-identity"><span class="gt-heading-icon" aria-hidden="true">GT</span><div><h1 id="orderan-gt-title">Orderan GT</h1><p>Status order dan progres picking dari LIST GT ORDER.</p></div></div>
    <button class="btn-ghost" type="button" data-gt-refresh>Perbarui data</button>
  </header>
  <div class="gt-metrics" data-gt-metrics hidden></div>
  <section class="gt-status-summary" aria-labelledby="gt-status-title" data-gt-status-summary hidden>
    <h2 id="gt-status-title">Order per status</h2>
    <div class="gt-status-cards" data-gt-status-cards></div>
  </section>
  <div class="gt-controls" data-gt-controls hidden>
    <label><span>Cari order</span><input type="search" data-gt-search placeholder="Customer, SKU, produk, atau status…"></label>
    <label><span>Tampilkan</span><select data-gt-view aria-label="Tampilkan"><option value="active">Order berjalan</option><option value="all">Semua order</option></select></label>
    <label><span>Status</span><select data-gt-status aria-label="Status"><option value="">Semua status</option></select></label>
    <label><span>Status Picking</span><select data-gt-picking aria-label="Status Picking"><option value="">Semua status picking</option></select></label>
    <button class="btn-ghost gt-reset" type="button" data-gt-reset hidden>Reset filter</button>
  </div>
  <p class="gt-feedback" data-gt-feedback role="status"></p>
  <div class="gt-results" data-gt-results hidden>
    <h2>Daftar order</h2>
    <p data-gt-results-count role="status"></p>
  </div>
  <div class="gt-loading" data-gt-loading aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="gt-orders" data-gt-orders></div>
  <footer class="gt-pager" data-gt-pager hidden><span data-gt-count></span><button class="btn-ghost" type="button" data-gt-prev>Sebelumnya</button><button class="btn-ghost" type="button" data-gt-next>Berikutnya</button></footer>`;
  const el = name => root.querySelector(`[data-gt-${name}]`);
  function render() {
    const search = el('search').value;
    const status = el('status').value;
    const pickingStatus = el('picking').value;
    for (const card of el('status-cards').children) card.setAttribute('aria-pressed',String(card.dataset.status===status));
    el('reset').hidden = !search && view === 'active' && !status && !pickingStatus;
    const matches = filterGtOrders(orders,view,search,{status,pickingStatus});
    const activeFilters = [view==='active'?'Order berjalan':'Semua order',status && `Status: ${status}`,pickingStatus && `Picking: ${pickingStatus}`,search.trim() && `Cari: ${search.trim()}`].filter(Boolean);
    el('results').hidden = false;
    el('results-count').textContent = `${number.format(matches.length)} order · ${activeFilters.join(' · ')}`;
    const offset = (page-1)*PAGE_SIZE;
    el('orders').innerHTML = matches.slice(offset,offset+PAGE_SIZE).map(orderMarkup).join('') || `<div class="gt-empty"><strong>${orders.length?'Tidak ada order yang cocok.':'Belum ada order di LIST GT ORDER.'}</strong>${orders.length?'<p>Coba ubah pencarian atau filter.</p>':''}</div>`;
    el('pager').hidden = !matches.length;
    el('count').textContent = `${number.format(offset+1)}–${number.format(Math.min(offset+PAGE_SIZE,matches.length))} dari ${number.format(matches.length)} order · baris terbaru dulu`;
    el('prev').disabled = page===1;
    el('next').disabled = offset+PAGE_SIZE>=matches.length;
  }
  async function refresh() {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    el('refresh').disabled = true;
    el('loading').hidden = loaded;
    const expanded = new Set([...el('orders').querySelectorAll('details[open]')].map(order=>order.dataset.gtRow));
    el('feedback').textContent = 'Memuat LIST GT ORDER…';
    try {
      const data = await read(request.signal);
      if (request.signal.aborted) return;
      orders = data.orders;
      for (const [control,field,placeholder] of [['status','status','Semua status'],['picking','pickingStatus','Semua status picking']]) {
        const select = el(control);
        const selected = select.value;
        const values = [...new Set(orders.flatMap(order=>order.items.map(item=>item[field])).filter(Boolean))];
        if (selected && !values.includes(selected)) values.push(selected);
        values.sort((left,right)=>left.localeCompare(right,'id'));
        select.replaceChildren(new Option(placeholder,''),...values.map(value=>new Option(value,value)));
        select.value = selected;
      }
      const active = orders.filter(order=>order.active);
      el('metrics').innerHTML = [[active.length,'Order berjalan'],[active.reduce((total,order)=>total+order.items.length,0),'Item pada order berjalan']].map(([value,label])=>`<div class="metric"><span class="k">${label}</span><strong class="v">${number.format(value)}</strong></div>`).join('');
      const statusCounts = gtOrderStatusCounts(orders);
      el('status-summary').hidden = !statusCounts.length;
      el('status-cards').innerHTML = statusCounts.map(([status,count])=>`<button class="metric gt-status-card" type="button" data-status="${escape(status)}" aria-pressed="false"><span class="k">${escape(status)}</span><strong class="v">${number.format(count)}</strong></button>`).join('');
      el('metrics').hidden = el('controls').hidden = false;
      el('feedback').textContent = `Terakhir dibaca ${date.format(new Date(data.lastReadAt))} WIB`;
      loaded = true;
      page = Math.min(page,Math.max(1,Math.ceil(filterGtOrders(orders,view,el('search').value,{
        status:el('status').value,pickingStatus:el('picking').value
      }).length/PAGE_SIZE)));
      render();
      for (const order of el('orders').querySelectorAll('details')) order.open = expanded.has(order.dataset.gtRow);
    } catch (error) {
      if (!request.signal.aborted) el('feedback').textContent = (error.message || 'Gagal memuat Orderan GT.') + (loaded ? ' Data sebelumnya masih ditampilkan.' : '');
    } finally {
      if (!request.signal.aborted) {
        el('refresh').disabled = false;
        el('loading').hidden = true;
      }
    }
  }
  el('refresh').onclick = refresh;
  el('search').oninput = () => { page=1;render(); };
  el('view').onchange = event => { view=event.target.value;page=1;render(); };
  el('status').onchange = el('picking').onchange = () => { page=1;render(); };
  el('status-cards').onclick = event => {
    const card = event.target.closest('button[data-status]');
    if (!card) return;
    const select = el('status');
    select.value = select.value === card.dataset.status ? '' : card.dataset.status;
    el('view').value = view = 'all';
    page=1;
    render();
  };
  el('reset').onclick = () => {
    view = 'active';
    el('view').value = view;
    for (const name of ['search','status','picking']) el(name).value = '';
    page=1;
    render();
    el('search').focus();
  };
  el('prev').onclick = () => {page--;render();};
  el('next').onclick = () => {page++;render();};
  void refresh();
  return {refresh,dispose(){controller?.abort();root.replaceChildren();}};
}
