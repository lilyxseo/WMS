import { onRequestPatch as patch } from '../_cell-update.js';

const MOVEMENT_FIELD_COLUMNS = {
  tanggal: "A",
  from: "B",
  to: "C",
  sku: "D",
  namaBarang: "E",
  stokDiLokasiAwal: "F",
  stokAktual: "G"
};
export async function onRequestPatch(ctx){return patch(ctx,{fieldMap:MOVEMENT_FIELD_COLUMNS,sheetName:'Movement',spreadsheetIdEnv:'SHEET_ID_INVENTORY',invalidFieldMessage:'Invalid movement field',blockedFields:['sku','namaBarang'],validators:{tanggal:value=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));if(!match)return 'tanggal harus berformat YYYY-MM-DD';const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3])?'':'tanggal tidak valid';}}});}
