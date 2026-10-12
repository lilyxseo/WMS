import { json, getAccessToken, escSheet, buildHeaderInfo } from './_utils.js';
import { requirePicRole } from '../_authz.js';

export async function onRequestPatch({ request, env }) {
  const authz = await requirePicRole({ request, env });
  if (!authz.ok) return authz.response;
  try {
    const body = await request.json();
    const sheetName = String(body?.sheetName || '').trim();
    const rowNumber = Number(body?.rowNumber);
    const checked = body?.checked === true;
    if (!sheetName) return json({ message: 'sheetName wajib diisi' }, 400);
    if (!Number.isInteger(rowNumber) || rowNumber <= 1) return json({ message: 'rowNumber tidak valid' }, 400);
    const accessToken = await getAccessToken(env);
    const readRange = `${escSheet(sheetName)}!A1:ZZ10`;
    const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_INVENTORY}/values/${encodeURIComponent(readRange)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const readData = await readRes.json();
    if (!readRes.ok) return json({ message: readData.error?.message || 'Gagal membaca header sheet' }, readRes.status);

    const headerInfo = buildHeaderInfo(readData.values || []);
    if (!headerInfo) return json({ message: 'Header tidak valid. Pastikan ada kolom SKU, Nama Barang, dan Qty.' }, 400);

    const checkedCol = headerInfo.columnMap.checked;
    if (checkedCol === undefined) return json({ message: 'Kolom Centang tidak ditemukan di sheet ini' }, 400);

    const colLetter = (() => {
      let n = checkedCol;
      let letter = '';
      while (n >= 0) {
        letter = String.fromCharCode((n % 26) + 65) + letter;
        n = Math.floor(n / 26) - 1;
      }
      return letter;
    })();

    const range = `${escSheet(sheetName)}!${colLetter}${rowNumber}`;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_INVENTORY}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [[checked ? 'TRUE' : 'FALSE']] }) });
    const data = await res.json();
    if (!res.ok) return json({ message: data.error?.message || 'Gagal update centang' }, res.status);
    return json({ success: true });
  } catch (err) { return json({ message: err?.message || 'Internal server error' }, 500); }
}