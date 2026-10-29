import {buildHeaderInfo} from './_utils.js';
export function parseBalikanSheet(rows){
    const headerInfo = buildHeaderInfo(rows);
    if (!headerInfo) throw Error('Header tidak valid. Pastikan ada kolom SKU, Nama Barang, dan Qty.');
    const headers = rows[headerInfo.headerRowIndex] || [];
    if (headerInfo.columnMap.checked === undefined) {
      throw Error('Kolom Centang tidak ditemukan');
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
return {rows:out,dynamicColumns:dynamicColumns.map(({key,header})=>({key,header}))};
}
