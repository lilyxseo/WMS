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
