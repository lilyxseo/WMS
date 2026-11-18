const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const normal=key=>String(key).replace(/[^a-z0-9]/gi,'').toLowerCase();
const internal=new Set(['rownumber','sourcerownumber','rowref','rowrefs','sourcerow','baris','nomorbaris','tabel','tableindex','syncedat']);
const labels={sku:'SKU',namabarang:'Nama Barang',tanggal:'Tanggal',qty:'Qty',lokasi:'Lokasi',lokasibulky:'Lokasi',stokawal:'Stok Awal',stokakhir:'Stok Akhir',stoklokasiawal:'Stok Lokasi Awal',stokaktual:'Stok Aktual',checked:'Centang',checkedraw:'Centang',noiseller:'No iSeller',noisellerawal:'No iSeller Awal',pic:'PIC',from:'From',to:'To',sheet:'Sumber Sheet',sheetname:'Sumber Sheet',keteranganlainnya:'Keterangan Lainnya',lokasisuratjalan:'Lokasi Surat Jalan',statuslanjutan:'Status Lanjutan',dokumen:'Dokumen',stockout:'Stock Out',status:'Status',statusbarang:'Status',statusproses:'Status Proses',keterangan:'Keterangan',type:'Jenis',netsuite:'NetSuite',stckoutreject:'Stock Out Reject',centang:'Centang',jumlah:'Qty',quantity:'Qty',date:'Tanggal',location:'Lokasi',namaproduk:'Nama Barang',productname:'Nama Barang',sumbersheet:'Sumber Sheet'};
export function advanceBoolean(value){if(typeof value==='boolean')return value;return typeof value==='string'&&/^(true|false)$/i.test(value.trim())?value.trim().toLowerCase()==='true':null;}
const empty=value=>value===null||value===undefined||typeof value==='string'&&!value.trim();
const family=key=>({lokasibulky:'lokasi',lokasi:'lokasi',checkedraw:'checked',checked:'checked',displayname:'sku',sku:'sku',sheetname:'sheet',sumbersheet:'sheet',statusbarang:'status',centang:'checked',quantity:'qty',jumlah:'qty',date:'tanggal',location:'lokasi',namaproduk:'namabarang',productname:'namabarang'}[normal(key)]||normal(key));
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
const transactionColumns=['tanggal','from','to','sku','namabarang','qty','status','pic','keterangan'];
const inventoryColumns=['sku','namabarang','lokasi','tanggal','qty','stokawal','stokakhir','stoklokasiawal','stokaktual','aktual','status','pic','keterangan'];
const trailingColumns=new Set(['sheet','type']);
function orderedGroups(groups,alignReject){
 const keys=new Set(groups.map(group=>family(group.column)));
 const order=alignReject||keys.has('from')||keys.has('to')||(keys.has('tanggal')&&keys.has('qty'))?transactionColumns:inventoryColumns;
 const remaining=[...groups];
 const ordered=[];
 for(const column of order){
  const index=remaining.findIndex(group=>family(group.column)===column);
  if(index>=0)ordered.push(...remaining.splice(index,1));
  else if(alignReject)ordered.push({column,keys:[column]});
 }
 return [...ordered,...remaining.filter(group=>!trailingColumns.has(family(group.column))),...remaining.filter(group=>trailingColumns.has(family(group.column)))];
}
export function advanceColumns(rows){return orderedGroups(columnGroups(rows),false).map(group=>group.column);}
const columnValue=(row,keys)=>{const key=keys.find(key=>!empty(row[key]));return key===undefined?row[keys[0]]:row[key];};
const external=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url:null;}catch{return null;}};
const openIcon='<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M6 3H3v10h10v-3M8 3h5v5M7 9l6-6"/></svg>';
export function advanceCell(value,column='',{balikanCheckbox=false}={}){
 const bool=advanceBoolean(value);
 if(bool!==null&&balikanCheckbox&&family(column)==='checked')return `<input type="checkbox" class="balikan-check advance-balikan-check" ${bool?'checked ':''}disabled aria-label="${bool?'Dicentang':'Tidak dicentang'}" title="${bool?'Dicentang':'Tidak dicentang'}">`;
 if(bool!==null)return `<span class="advance-check ${bool?'is-checked':''}" role="img" aria-label="${bool?'Dicentang':'Tidak dicentang'}" title="${bool?'Dicentang':'Tidak dicentang'}">${bool?'<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="m3 8 3 3 7-7"/></svg>':''}</span>`;
 if(value===null||value===undefined||value==='')return '<span class="advance-empty-cell" aria-label="Kosong">—</span>';
 if(typeof value!=='string')return esc(typeof value==='object'?JSON.stringify(value):value);
 const matches=[...value.matchAll(/https?:\/\/[^\s<>"']+/gi)];if(!matches.length)return esc(value);
 let result='',offset=0,index=0;
 for(const match of matches){const raw=match[0],url=external(raw);if(!url)continue;result+=esc(value.slice(offset,match.index));index++;const label=/dokumen|document|file|pdf/i.test(column)?'Lihat dokumen':'Buka tautan';result+=`<a class="advance-link-button" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="${esc(url.href)}">${openIcon}<span>${label}${matches.length>1?' '+index:''}</span><small>${esc(url.hostname)}</small></a>`;offset=match.index+raw.length;}
 return result+esc(value.slice(offset));
}
function columnLayout(column,rows){
 const name=family(column);
 if(/^(qty|quantity|jumlah|count[12]?|aktual|selisih|stok.*|stock.*|saldo.*|akurasi|accuracy)$/.test(name))return {kind:'number',width:112};
 if(/tanggal|date|timestamp|createdat|updatedat/.test(name))return {kind:'date',width:140};
 if(/nama|name|catatan|keterangan|note|description|alasan/.test(name)&&name!=='sheetname'&&name!=='displayname')return {kind:'text',width:260};
 if(/sku|barcode|iseller|netsuite|displayname/.test(name))return {kind:'identifier',width:160};
 if(/link|url|dokumen|document|file|pdf/.test(name))return {kind:'link',width:220};
 const values=rows.map(row=>row[column]).filter(value=>!empty(value));
 if(name==='checked'||(!transactionColumns.includes(name)&&values.length&&values.every(value=>advanceBoolean(value)!==null)))return {kind:'boolean',width:80};
 return {kind:'text',width:152};
}
export function advanceTable(rows,options={}){
 if(!rows.length)return '<div class="advance-empty-state">Tidak ada data untuk SKU ini.</div>';
 const groups=orderedGroups(columnGroups(rows),options.alignReject),columns=groups.map(group=>group.column);
 if(!columns.length)return '<div class="advance-empty-state">Tidak ada kolom data untuk ditampilkan.</div>';
 const projected=rows.map(row=>Object.fromEntries(groups.map(group=>[group.column,columnValue(row,group.keys)]))),layout=columns.map(column=>columnLayout(column,projected)),width=layout.reduce((sum,column)=>sum+column.width,0);
 return `<div class="table-wrap advance-table-wrap" tabindex="0" role="region" aria-label="Tabel data sumber, geser untuk melihat semua kolom"><table class="advance-data-table" style="--advance-table-width:${width}px"><colgroup>${layout.map(column=>`<col style="--advance-column-width:${column.width}px">`).join('')}</colgroup><thead><tr>${columns.map((column,index)=>`<th scope="col" class="advance-column-${layout[index].kind}">${esc(labels[normal(column)]||column)}${columns.some(other=>other!==column&&(labels[normal(other)]||other)===(labels[normal(column)]||column))?' ('+esc(column)+')':''}</th>`).join('')}</tr></thead><tbody>${projected.map(row=>`<tr>${columns.map((column,index)=>`<td class="advance-column-${layout[index].kind}${advanceBoolean(row[column])!==null?' advance-boolean-cell':''}">${advanceCell(row[column],column,options)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="advance-table-footer"><span>${rows.length.toLocaleString('id-ID')} baris data</span><span>Geser tabel untuk melihat kolom lainnya</span></div>`;
}
