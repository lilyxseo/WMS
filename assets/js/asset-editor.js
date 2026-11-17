const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
export function assetEditorFields(columns,row={}){
 return columns.map((column,index)=>{
  const value=String(row?.[column]??''),name=String(column).trim();
  const multiline=/catatan|keterangan|deskripsi|description|alamat|notes?/i.test(name);
  const numeric=/^(qty|quantity|jumlah|harga|nilai)$/i.test(name)&&(!value.trim()||Number.isFinite(Number(value)));
  const attrs=`id="assetField${index}" name="field${index}" maxlength="10000"`;
  const control=multiline?`<textarea ${attrs} rows="3" placeholder="Tambahkan ${esc(name.toLowerCase())}">${esc(value)}</textarea>`:`<input ${attrs} type="${numeric?'number':'text'}" ${numeric?'step="any" inputmode="decimal"':''} value="${esc(value)}" placeholder="Masukkan ${esc(name.toLowerCase())}">`;
  return `<label class="asset-editor-field${multiline?' asset-editor-field--wide':''}" for="assetField${index}"><span>${esc(name)}</span>${control}${numeric?'<small>Isi angka tanpa pemisah ribuan.</small>':''}</label>`;
 }).join('');
}
