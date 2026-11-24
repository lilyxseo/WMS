const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = new Intl.NumberFormat('id-ID');
const date = new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'});
const qty = value => value == null ? '—' : number.format(value);
const cell = value => escape(value || '—');
const PAGE_SIZE = 15;

export function filterGtOrders(orders, view, search) {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return orders.filter(order => {
    if (view === 'active' && !order.active) return false;
    if (view === 'review' && !order.missingSku) return false;
    const haystack = [order.customer,...order.items.flatMap(item => [item.sku,item.product,item.status,item.pickingStatus,item.payment])].join(' ').toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
function orderMarkup(order) {
  const statuses = [...new Set(order.items.map(item => item.status).filter(Boolean))];
  const skus = [...new Set(order.items.map(item => item.sku).filter(Boolean))];
  const totalQty = field => order.items.some(item=>item[field] != null)
    ? order.items.reduce((total,item)=>total+(item[field] ?? 0),0)
    : null;
  return `<details class="gt-order">
    <summary>
      <div class="gt-order-summary">
        <strong>${escape(order.customer || 'Customer belum tercatat')}</strong>
        <small>Baris ${number.format(order.row)} · ${number.format(order.items.length)} item · ${number.format(skus.length)} SKU</small>
        <small>Qty request ${qty(totalQty('requested'))} · Qty picking ${qty(totalQty('picked'))}</small>
      </div>
      <div class="gt-order-status">
        ${(statuses.length ? statuses : ['Status belum diisi']).map(status => `<span class="gt-badge">${escape(status)}</span>`).join('')}
        ${order.missingSku ? `<span class="gt-badge gt-badge-warning">${number.format(order.missingSku)} item tanpa SKU</span>` : ''}
      </div>
    </summary>
    <div class="gt-table" tabindex="0" role="region" aria-label="Item order baris ${order.row}">
      <table><thead><tr>${['SKU','Nama produk','Qty request','Qty picking','Status','Payment','Status picking','Bulky','Retail','Ket','Remark'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead>
      <tbody>${order.items.map(item => `<tr>
        <td class="gt-sku">${item.sku ? `<a href="/sku/${encodeURIComponent(item.sku)}">${escape(item.sku)}</a>` : '<span class="gt-badge gt-badge-warning">SKU kosong</span>'}</td>
        <td>${cell(item.product)}</td><td>${qty(item.requested)}</td><td>${qty(item.picked)}</td><td>${cell(item.status)}</td><td>${cell(item.payment)}</td><td>${cell(item.pickingStatus)}</td><td>${qty(item.bulky)}</td><td>${qty(item.retail)}</td><td>${cell(item.note)}</td><td>${cell(item.remark)}</td>
      </tr>`).join('')}</tbody></table>
    </div>
  </details>`;
}

export function mountGtOrders(root, {read}) {
  let orders = [], view = 'active', page = 1, controller, loaded = false;
  root.innerHTML = `<header class="gt-heading">
    <div><h1 id="orderan-gt-title">Orderan GT</h1><p>Pantau order, status picking, dan SKU dari LIST GT ORDER.</p></div>
    <button class="btn-ghost" type="button" data-gt-refresh>Perbarui data</button>
  </header>
  <div class="gt-metrics" data-gt-metrics hidden></div>
  <div class="gt-controls" data-gt-controls hidden>
    <label><span>Cari order</span><input type="search" data-gt-search placeholder="Customer, SKU, produk, atau status…"></label>
    <label><span>Tampilkan</span><select data-gt-view><option value="active">Order berjalan</option><option value="all">Semua order</option><option value="review">Item tanpa SKU</option></select></label>
  </div>
  <p class="gt-feedback" data-gt-feedback role="status"></p>
  <div class="gt-orders" data-gt-orders></div>
  <footer class="gt-pager" data-gt-pager hidden><span data-gt-count></span><button class="btn-ghost" type="button" data-gt-prev>Sebelumnya</button><button class="btn-ghost" type="button" data-gt-next>Berikutnya</button></footer>`;
  const el = name => root.querySelector(`[data-gt-${name}]`);
  function render() {
    const matches = filterGtOrders(orders,view,el('search').value);
    const offset = (page-1)*PAGE_SIZE;
    el('orders').innerHTML = matches.slice(offset,offset+PAGE_SIZE).map(orderMarkup).join('') || '<div class="state">Tidak ada order yang cocok.</div>';
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
    el('feedback').textContent = 'Memuat LIST GT ORDER…';
    try {
      const data = await read(request.signal);
      if (request.signal.aborted) return;
      orders = data.orders;
      const active = orders.filter(order=>order.active);
      const missing = orders.reduce((total,order)=>total+order.missingSku,0);
      el('metrics').innerHTML = [[active.length,'Order berjalan'],[active.reduce((total,order)=>total+order.items.length,0),'Item pada order berjalan'],[missing,'Item tanpa SKU']].map(([value,label])=>`<div class="metric"><span class="k">${label}</span><strong class="v">${number.format(value)}</strong></div>`).join('');
      el('metrics').hidden = el('controls').hidden = false;
      el('feedback').textContent = `Terakhir dibaca ${date.format(new Date(data.lastReadAt))} WIB`;
      loaded = true;
      page = 1;
      render();
    } catch (error) {
      if (!request.signal.aborted) el('feedback').textContent = (error.message || 'Gagal memuat Orderan GT.') + (loaded ? ' Data sebelumnya masih ditampilkan.' : '');
    } finally {
      if (!request.signal.aborted) el('refresh').disabled = false;
    }
  }
  el('refresh').onclick = refresh;
  el('search').oninput = () => { page=1;render(); };
  el('view').onchange = event => { view=event.target.value;page=1;render(); };
  el('prev').onclick = () => {page--;render();};
  el('next').onclick = () => {page++;render();};
  void refresh();
  return {refresh,dispose(){controller?.abort();root.replaceChildren();}};
}
