const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
export function assetToday(now=new Date()){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function assetEditorFields(columns,row={}, {create=false,sectionOptions=[],now=new Date()}={}){
 return columns.map((column,index)=>{
  const name=String(column).trim(),date=/^(date|tanggal)$/i.test(name);
  const value=String(row?.[column]??(create&&date?assetToday(now):''));
  const multiline=/catatan|keterangan|deskripsi|description|alamat|notes?/i.test(name);
  const numeric=/^(qty|quantity|jumlah|harga|nilai)$/i.test(name)&&(!value.trim()||Number.isFinite(Number(value)));
  const attrs=`id="assetField${index}" name="field${index}" maxlength="10000"`;
  const choices=[...new Set([...sectionOptions,...(value?[value]:[])].map(String).filter(item=>item.trim()))];
  const control=/^section$/i.test(name)?`<select id="assetField${index}" name="field${index}"><option value="">Pilih section (opsional)</option>${choices.map(option=>`<option value="${esc(option)}" ${option===value?'selected':''}>${esc(option)}</option>`).join('')}</select>`:multiline?`<textarea ${attrs} rows="3" placeholder="Tambahkan ${esc(name.toLowerCase())}">${esc(value)}</textarea>`:`<input ${attrs} type="${date&&(/^\d{4}-\d{2}-\d{2}$/.test(value)||!value)?'date':numeric?'number':'text'}" ${numeric?'step="any" inputmode="decimal"':''} value="${esc(value)}" placeholder="Masukkan ${esc(name.toLowerCase())}">`;
  return `<label class="asset-editor-field${multiline?' asset-editor-field--wide':''}" for="assetField${index}"><span>${esc(name)} <small class="asset-optional">Opsional</small></span>${control}${numeric?'<small>Isi angka tanpa pemisah ribuan.</small>':''}</label>`;
 }).join('');
}
