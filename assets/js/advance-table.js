const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const normal=key=>String(key).replace(/[^a-z0-9]/gi,'').toLowerCase();
const internal=new Set(['rownumber','sourcerownumber','rowref','rowrefs','sourcerow','baris','nomorbaris','tabel','tableindex','syncedat']);
const labels={sku:'SKU',namabarang:'Nama Barang',tanggal:'Tanggal',qty:'Qty',lokasi:'Lokasi',lokasibulky:'Lokasi',stokawal:'Stok Awal',stokakhir:'Stok Akhir',stoklokasiawal:'Stok Lokasi Awal',stokaktual:'Stok Aktual',checked:'Centang',checkedraw:'Centang',noiseller:'No iSeller',noisellerawal:'No iSeller Awal',pic:'PIC',from:'From',to:'To',sheet:'Sumber Sheet',sheetname:'Sumber Sheet',keteranganlainnya:'Keterangan Lainnya',lokasisuratjalan:'Lokasi Surat Jalan',statuslanjutan:'Status Lanjutan',dokumen:'Dokumen',stockout:'Stock Out'};
export function advanceBoolean(value){if(typeof value==='boolean')return value;return typeof value==='string'&&/^(true|false)$/i.test(value.trim())?value.trim().toLowerCase()==='true':null;}
export function advanceColumns(rows){
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
 return columns.filter(column=>{
  const name=normal(column);if(internal.has(name)||column.startsWith('_'))return false;
  if(name==='checkedraw'&&columns.some(key=>normal(key)==='checked'))return false;
  if(column!=='sku'&&['sku','displayname'].includes(name)&&columns.includes('sku')&&rows.every(row=>row[column]===undefined||String(row[column]).trim()===String(row.sku??'').trim()))return false;
  return true;
 });
}
const external=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url:null;}catch{return null;}};
const openIcon='<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M6 3H3v10h10v-3M8 3h5v5M7 9l6-6"/></svg>';
export function advanceCell(value,column=''){
 const bool=advanceBoolean(value);
 if(bool!==null)return `<span class="advance-check ${bool?'is-checked':''}" role="img" aria-label="${bool?'Dicentang':'Tidak dicentang'}" title="${bool?'Dicentang':'Tidak dicentang'}">${bool?'<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="m3 8 3 3 7-7"/></svg>':''}</span>`;
 if(value===null||value===undefined||value==='')return '<span class="advance-empty-cell" aria-label="Kosong">—</span>';
 if(typeof value!=='string')return esc(typeof value==='object'?JSON.stringify(value):value);
 const matches=[...value.matchAll(/https?:\/\/[^\s<>"']+/gi)];if(!matches.length)return esc(value);
 let result='',offset=0,index=0;
 for(const match of matches){const raw=match[0],url=external(raw);if(!url)continue;result+=esc(value.slice(offset,match.index));index++;const label=/dokumen|document|file|pdf/i.test(column)?'Lihat dokumen':'Buka tautan';result+=`<a class="advance-link-button" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="${esc(url.href)}">${openIcon}<span>${label}${matches.length>1?' '+index:''}</span><small>${esc(url.hostname)}</small></a>`;offset=match.index+raw.length;}
 return result+esc(value.slice(offset));
}
export function advanceTable(rows){
 if(!rows.length)return '<div class="advance-empty-state">Tidak ada data untuk SKU ini.</div>';
 const columns=advanceColumns(rows);
 if(!columns.length)return '<div class="advance-empty-state">Tidak ada kolom data untuk ditampilkan.</div>';
 return `<div class="table-wrap advance-table-wrap" tabindex="0" aria-label="Tabel data sumber, geser untuk melihat semua kolom"><table class="advance-data-table"><thead><tr>${columns.map(column=>`<th scope="col">${esc(labels[normal(column)]||column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(column=>`<td class="${advanceBoolean(row[column])!==null?'advance-boolean-cell':''}">${advanceCell(row[column],column)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="advance-table-footer"><span>${rows.length.toLocaleString('id-ID')} baris data</span><span>Geser tabel untuk melihat kolom lainnya</span></div>`;
}
