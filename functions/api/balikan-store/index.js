import { json, getAccessToken, escSheet, buildHeaderInfo } from './_utils';
import { fetchLocationInventory, LOCATION_INVENTORY_QTY_FIELD, LOCATION_INVENTORY_TABLE } from './_location-inventory.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sheetName = String(url.searchParams.get('sheetName') || '').trim();
    if (!sheetName) return json({ message: 'sheetName wajib diisi' }, 400);
    const accessToken = await getAccessToken(env);
    const range = `${escSheet(sheetName)}!A1:ZZ`;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_INVENTORY}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) return json({ message: data.error?.message || 'Gagal membaca data sheet' }, res.status);
    const rows = data.values || [];
    const headerInfo = buildHeaderInfo(rows);
    if (!headerInfo) return json({ message: 'Header tidak valid. Pastikan ada kolom SKU, Nama Barang, dan Qty.' }, 400);
    const headers = rows[headerInfo.headerRowIndex] || [];
    console.log("headers", headers);
    console.log("columnMap", headerInfo.columnMap);
    if (headerInfo.columnMap.checked === undefined) {
      return json({ message: 'Kolom Centang tidak ditemukan' }, 400);
    }

    const mappedColumns = new Set(Object.values(headerInfo.columnMap));
    const dynamicColumns = headers
      .map((headerName, index) => ({ index, headerName: String(headerName || '').trim() }))
      .filter(({ index, headerName }) => headerName && !mappedColumns.has(index))
      .map(({ index, headerName }) => ({ key: `extra_${index}`, header: headerName, colIndex: index }));
    const dynamicColumnMap = Object.fromEntries(dynamicColumns.map((col) => [col.key, col.colIndex]));
    const getCell = (row, field) => {
      const colIndex = headerInfo.columnMap[field] ?? dynamicColumnMap[field];
      if (colIndex === undefined) return '';
      return String((row || [])[colIndex] || '').trim();
    };

    const out = [];
    for (let i = headerInfo.dataStartIndex; i < rows.length; i++) {
      const r = rows[i] || [];
      if (!r.some((cell) => String(cell || '').trim())) continue;
      const sku = getCell(r, 'sku');
      const namaBarang = getCell(r, 'namaBarang');
      if (!sku && !namaBarang) continue;
      const rowData = {
        rowNumber: i + 1,
        checkedRaw: (r || [])[headerInfo.columnMap.checked],
        checked: (r || [])[headerInfo.columnMap.checked],
        no: getCell(r, 'no'),
        sku,
        namaBarang,
        qty: getCell(r, 'qty'),
        rakTujuan: getCell(r, 'rakTujuan'),
        lokasi: getCell(r, 'lokasi'),
        stokBulky: getCell(r, 'stokBulky'),
        stokRetail: getCell(r, 'stokRetail'),
        status: getCell(r, 'status'),
        keterangan: getCell(r, 'keterangan')
      };
      dynamicColumns.forEach((col) => {
        rowData[col.key] = getCell(r, col.key);
      });
      out.push(rowData);
    }
    let locationInventory = {};
    let locationInventoryError = null;
    try {
      locationInventory = await fetchLocationInventory(env, out.map(row => row.sku));
    } catch (error) {
      locationInventoryError = error?.message || 'Gagal membaca inventory lokasi';
      console.error('[BalikanStore] Location inventory lookup failed', locationInventoryError);
    }
    out.forEach(row => {
      row.locations = locationInventory[String(row.sku || '').trim().toLowerCase()] || [];
    });
    return json({
      sheetName,
      rows: out,
      dynamicColumns: dynamicColumns.map(({ key, header }) => ({ key, header })),
      locationInventory,
      locationInventorySource: {
        table: `public.${LOCATION_INVENTORY_TABLE}`,
        locationField: 'lokasi_bulky',
        qtyField: LOCATION_INVENTORY_QTY_FIELD,
        aggregatedBy: ['sku', 'lokasi_bulky'],
      },
      locationInventoryError,
    });
  } catch (err) { return json({ message: err?.message || 'Internal server error' }, 500); }
}
