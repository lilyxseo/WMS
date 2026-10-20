import { getGoogleAccessToken } from './_google-auth.js';
export const SHEET_BARANG_MASUK='Barang Masuk';
export const SHEET_BARANG_KELUAR='Barang KeIuar';
export const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});

export async function token(env) { return getGoogleAccessToken(env); }
export const FIELD_MAP={tanggal:'A',from:'B',to:'C',sku:'D',namaBarang:'E',qty:'F',status:'G',pic:'H',keterangan:'I',no_iseller:'J',netsuite:'K',keterangan_lainnya:'L',lokasi_surat_jalan:'M',stockout:'N',dokumen:'O'};
export const BARANG_KELUAR_FIELD_MAP={tanggal:'A',from:'B',to:'C',sku:'D',namaBarang:'E',qty:'F',status:'G',pic:'H',keterangan:'I',no_iseller:'J',netsuite:'K',keterangan_lainnya:'L',status_lanjutan:'M',lokasi_surat_jalan:'N',no_iseller_awal:'O',dokumen:'P'};
export const BARANG_COLUMNS=['tanggal','from','to','sku','namaBarang','qty','status','pic','keterangan'];
export const BARANG_MASUK_COLUMNS=[...BARANG_COLUMNS,'no_iseller','netsuite','keterangan_lainnya','lokasi_surat_jalan','stockout','dokumen'];
export const BARANG_KELUAR_COLUMNS=[...BARANG_COLUMNS,'no_iseller','netsuite','keterangan_lainnya','status_lanjutan','lokasi_surat_jalan','no_iseller_awal','dokumen'];
export const barangDataRange=(sheetName,startRowNumber=2)=>`${sheetName}!A${startRowNumber}:${sheetName===SHEET_BARANG_MASUK?'O':'P'}`;
export function mapBarangSheetValues(values,startRowNumber=2){
  return (Array.isArray(values)?values:[])
    .map((row,index)=>({row:Array.isArray(row)?row:[],rowNumber:startRowNumber+index}))
    .filter(({row})=>row.some(cell=>String(cell??'').trim()))
    .map(({row,rowNumber})=>{
      const item={rowNumber};
      const columns=row.length>BARANG_COLUMNS.length?(row.length===BARANG_MASUK_COLUMNS.length?BARANG_MASUK_COLUMNS:BARANG_KELUAR_COLUMNS):BARANG_COLUMNS;
      columns.forEach((key,index)=>{item[key]=row[index]??'';});
      return item;
    });
}

export async function updateCells({env,sheetName,rowNumber,updates}){const access=await token(env);const sheetId=env.SHEET_ID_2026;const fieldMap=sheetName===SHEET_BARANG_KELUAR?BARANG_KELUAR_FIELD_MAP:FIELD_MAP;const data=Object.entries(updates).filter(([k])=>fieldMap[k]).map(([k,v])=>({range:`${sheetName}!${fieldMap[k]}${rowNumber}`,values:[[v??'']]}));
const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'USER_ENTERED',data})});
const out=await res.json();if(!res.ok)throw new Error(out.error?.message||'Gagal update');
}
export async function deleteRows({env,sheetName,rowNumbers}){const access=await token(env);const ss=env.SHEET_ID_2026;const meta=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ss}?fields=sheets.properties`,{headers:{Authorization:`Bearer ${access}`}});const m=await meta.json();const sh=(m.sheets||[]).find(s=>String(s.properties?.title||'')===sheetName);if(!sh){if(sheetName===SHEET_BARANG_KELUAR)throw new Error('Sheet Barang KeIuar tidak ditemukan di SHEET_ID_2026');throw new Error(`Sheet ${sheetName} tidak ditemukan di SHEET_ID_2026`);}const sorted=[...rowNumbers].sort((a,b)=>b-a);const requests=sorted.map(r=>({deleteDimension:{range:{sheetId:sh.properties.sheetId,dimension:'ROWS',startIndex:r-1,endIndex:r}}}));
const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ss}:batchUpdate`,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({requests})});const out=await res.json();if(!res.ok)throw new Error(out.error?.message||'Gagal hapus');
}

// Optional optimistic check used by SKU detail edits, whose row references come
// from the synchronized database rather than a fresh Google sheet read.
export async function verifyTransactionRow({env,sheetName,rowNumber,expected}){
 if(!expected||typeof expected!=='object'||typeof expected.sku!=='string'||!expected.cells||typeof expected.cells!=='object')throw Error('Snapshot transaksi tidak valid. Muat ulang detail SKU.');
 const access=await token(env),map=sheetName===SHEET_BARANG_KELUAR?BARANG_KELUAR_FIELD_MAP:FIELD_MAP,last=sheetName===SHEET_BARANG_KELUAR?'P':'O',range=`'${sheetName.replaceAll("'","''")}'!A${rowNumber}:${last}${rowNumber}`;
 const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_2026}/values/${encodeURIComponent(range)}`,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(20000)}),data=await response.json();if(!response.ok)throw Error('Transaksi belum dapat diperiksa di Google Sheets.');const row=data.values?.[0]||[];
 if(String(row[3]??'').trim()!==expected.sku.trim())throw Error('SKU pada baris sumber berubah. Muat ulang detail sebelum mengedit.');
 const canonicalDate=value=>{const text=String(value??'').trim(),match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);return match?`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`:text;};
 for(const [field,value]of Object.entries(expected.cells)){if(!map[field])throw Error('Kolom snapshot tidak valid.');const current=row[map[field].charCodeAt(0)-65]??'',same=field==='tanggal'?canonicalDate(current)===canonicalDate(value):field==='qty'?Number(current)===Number(value):String(current).trim()===String(value??'').trim();if(!same)throw Error('Data transaksi berubah. Muat ulang detail sebelum mengedit.');}
}
