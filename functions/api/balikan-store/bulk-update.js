import { json, getAccessToken, escSheet, buildHeaderInfo } from './_utils.js';
import { requirePicRole } from '../_authz.js';

const EDITABLE_FIELDS = {
  qty: 'Qty',
  rakTujuan: 'Rak tujuan',
  lokasi: 'Lokasi',
  stokBulky: 'Stok Bulky',
  stokRetail: 'Stok Retail',
  status: 'Status',
  keterangan: 'Keterangan'
};


const decodeLocationValue = (value) => {
  const raw = value == null ? '' : String(value).trim();
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw;
  try { return decodeURIComponent(raw).trim(); }
  catch (_err) { return raw; }
};

const colToLetter = (colIndex) => {
  let n = colIndex;
  let letter = '';
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
};

const resolveColumn = (field, headers, headerInfo) => {
  if (Object.prototype.hasOwnProperty.call(EDITABLE_FIELDS, field)) {
    return headerInfo.columnMap[field];
  }
  const dynamicMatch = String(field || '').match(/^extra_(\d+)$/);
  if (!dynamicMatch) return undefined;
  const colIndex = Number(dynamicMatch[1]);
  const mappedColumns = new Set(Object.values(headerInfo.columnMap));
  if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= headers.length) return undefined;
  if (mappedColumns.has(colIndex)) return undefined;
  if (!String(headers[colIndex] || '').trim()) return undefined;
  return colIndex;
};

export async function onRequestPost({ request, env, data: contextData }) {
  const authz = await requirePicRole({ request, env });
  if (!authz.ok) return authz.response;
  try {
    const body = await request.json();
    const sheetName = String(body?.sheetName || '').trim();
    const edits = Array.isArray(body?.edits) ? body.edits : [];

    if (!sheetName) return json({ success: false, message: 'sheetName wajib diisi' }, 400);
    if (!edits.length) return json({ success: false, message: 'edits wajib diisi' }, 400);

    const snapshot=contextData?.operationSnapshot;
    const accessToken = snapshot?.token || await getAccessToken(env);
    const readRange = `${escSheet(sheetName)}!A1:ZZ10`;
    let readData;
    if(snapshot?.headerValues)readData={values:snapshot.headerValues};else{
      const readRes=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_INVENTORY}/values/${encodeURIComponent(readRange)}`,{headers:{Authorization:`Bearer ${accessToken}`}});
      readData=await readRes.json();if(!readRes.ok)return json({success:false,message:'Gagal membaca header sheet'},readRes.status);
    }
    const rows = readData.values || [];
    const headerInfo = buildHeaderInfo(rows);
    if (!headerInfo) return json({ success: false, message: 'Header tidak valid. Pastikan ada kolom SKU, Nama Barang, dan Qty.' }, 400);
    const headers = rows[headerInfo.headerRowIndex] || [];

    const failed = [];
    const data = [], auditTargets=[];
    const seen = new Set();

    for (const edit of edits) {
      const rowNumber = Number(edit?.rowNumber);
      if (!Number.isInteger(rowNumber) || rowNumber <= 1) {
        failed.push({ rowNumber, field: '', message: 'rowNumber tidak valid' });
        continue;
      }
      const updates = edit?.updates && typeof edit.updates === 'object' ? edit.updates : {};
      for (const [fieldRaw, rawValue] of Object.entries(updates)) {
        const field = String(fieldRaw || '').trim();
        const colIndex = resolveColumn(field, headers, headerInfo);
        if (colIndex === undefined) {
          failed.push({ rowNumber, field, message: 'field tidak valid atau tidak dapat diedit' });
          continue;
        }
        const key = `${rowNumber}:${field}`;
        if (seen.has(key)) continue;
        seen.add(key);
        auditTargets.push({rowNumber,field});
        data.push({
          range: `${escSheet(sheetName)}!${colToLetter(colIndex)}${rowNumber}`,
          values: [[field === 'lokasi' ? decodeLocationValue(rawValue) : (rawValue == null ? '' : String(rawValue))]]
        });
      }
    }

    if (data.length) {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_INVENTORY}/values:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data, includeValuesInResponse:true, responseValueRenderOption:'FORMATTED_VALUE' })
      });
      const out = await res.json();
      if (!res.ok) return json({ success: false, message: out.error?.message || 'Gagal update data' }, res.status);
      if(!Array.isArray(out.responses)||out.responses.length!==data.length||out.responses.some(response=>!response?.updatedData))return json({success:false,message:'Penyimpanan Google Sheets belum terkonfirmasi. Periksa sheet sebelum mencoba lagi.'},502);
      auditTargets.forEach((target,index)=>{const change=contextData?.operationAudit?.metadata?.changes?.find(change=>change.rowNumber===target.rowNumber&&change.field===target.field);if(change){change.newValue=out.responses[index]?.updatedData?.values?.[0]?.[0]??'';change.afterSource='GOOGLE_SHEETS';}});
    }

    return json({ success: true, updated: data.length, failed });
  } catch (err) {
    return json({ success: false, message: err?.message || 'Internal server error' }, 500);
  }
}
