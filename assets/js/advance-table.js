const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const normal=key=>String(key).replace(/[^a-z0-9]/gi,'').toLowerCase();
const internal=new Set(['rownumber','sourcerownumber','rowref','rowrefs','sourcerow','baris','nomorbaris','tabel','tableindex','syncedat']);
const labels={sku:'SKU',namabarang:'Nama Barang',tanggal:'Tanggal',qty:'Qty',lokasi:'Lokasi',lokasibulky:'Lokasi',stokawal:'Stok Awal',stokakhir:'Stok Akhir',stoklokasiawal:'Stok Lokasi Awal',stokaktual:'Stok Aktual',checked:'Centang',checkedraw:'Centang',noiseller:'No iSeller',noisellerawal:'No iSeller Awal',pic:'PIC',from:'From',to:'To',sheet:'Sumber Sheet',sheetname:'Sumber Sheet',keteranganlainnya:'Keterangan Lainnya',lokasisuratjalan:'Lokasi Surat Jalan',statuslanjutan:'Status Lanjutan',dokumen:'Dokumen',stockout:'Stock Out'};
export function advanceBoolean(value){if(typeof value==='boolean')return value;return typeof value==='string'&&/^(true|false)$/i.test(value.trim())?value.trim().toLowerCase()==='true':null;}
const empty=value=>value===null||value===undefined||typeof value==='string'&&!value.trim();
const family=key=>({lokasibulky:'lokasi',lokasi:'lokasi',checkedraw:'checked',checked:'checked',displayname:'sku',sku:'sku',sheetname:'sheet',sheet:'sheet'}[normal(key)]||normal(key));
const comparable=value=>{const bool=advanceBoolean(value);return bool===null?String(value).trim():String(bool);};
function columnGroups(rows){
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(column=>!internal.has(normal(column))&&!column.startsWith('_'));
 const groups=[];
 for(const column of columns){
  const group=groups.find(group=>family(group[0])===family(column)&&rows.every(row=>group.every(key=>empty(row[key])||empty(row[column])||comparable(row[key])===comparable(row[column]))));
  if(group)group.push(column);else groups.push([column]);
 }
 return groups.map(keys=>{const preferred=keys.find(key=>key===family(keys[0]))||keys.find(key=>normal(key)===family(keys[0]))||keys[0];return {column:preferred,keys:[preferred,...keys.filter(key=>key!==preferred)]};});
}
export function advanceColumns(rows){return columnGroups(rows).map(group=>group.column);}
const columnValue=(row,keys)=>{const key=keys.find(key=>!empty(row[key]));return key===undefined?row[keys[0]]:row[key];};
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
function columnLayout(column,rows){
 const name=normal(column),values=rows.map(row=>row[column]).filter(value=>value!==null&&value!==undefined&&value!=='');
 if(values.length&&values.every(value=>advanceBoolean(value)!==null))return {kind:'boolean',width:80};
 if(/^(qty|quantity|jumlah|count[12]?|aktual|selisih|stok.*|stock.*|saldo.*|akurasi|accuracy)$/.test(name))return {kind:'number',width:112};
 if(/tanggal|date|timestamp|createdat|updatedat/.test(name))return {kind:'date',width:140};
 if(/nama|name|catatan|keterangan|note|description|alasan/.test(name)&&name!=='sheetname'&&name!=='displayname')return {kind:'text',width:260};
 if(/sku|barcode|iseller|netsuite|displayname/.test(name))return {kind:'identifier',width:160};
 if(/link|url|dokumen|document|file|pdf/.test(name))return {kind:'link',width:220};
 return {kind:'text',width:152};
}
export function advanceTable(rows){
 if(!rows.length)return '<div class="advance-empty-state">Tidak ada data untuk SKU ini.</div>';
 const groups=columnGroups(rows),columns=groups.map(group=>group.column);
 if(!columns.length)return '<div class="advance-empty-state">Tidak ada kolom data untuk ditampilkan.</div>';
 const projected=rows.map(row=>Object.fromEntries(groups.map(group=>[group.column,columnValue(row,group.keys)]))),layout=columns.map(column=>columnLayout(column,projected)),width=layout.reduce((sum,column)=>sum+column.width,0);
 return `<div class="table-wrap advance-table-wrap" tabindex="0" role="region" aria-label="Tabel data sumber, geser untuk melihat semua kolom"><table class="advance-data-table" style="--advance-table-width:${width}px"><colgroup>${layout.map(column=>`<col style="--advance-column-width:${column.width}px">`).join('')}</colgroup><thead><tr>${columns.map((column,index)=>`<th scope="col" class="advance-column-${layout[index].kind}">${esc(labels[normal(column)]||column)}${columns.some(other=>other!==column&&(labels[normal(other)]||other)===(labels[normal(column)]||column))?' ('+esc(column)+')':''}</th>`).join('')}</tr></thead><tbody>${projected.map(row=>`<tr>${columns.map((column,index)=>`<td class="advance-column-${layout[index].kind}${advanceBoolean(row[column])!==null?' advance-boolean-cell':''}">${advanceCell(row[column],column)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="advance-table-footer"><span>${rows.length.toLocaleString('id-ID')} baris data</span><span>Geser tabel untuk melihat kolom lainnya</span></div>`;
}
