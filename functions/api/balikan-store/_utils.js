import { getGoogleAccessToken } from '../_google-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

async function getAccessToken(env) { return getGoogleAccessToken(env); }

const escSheet = (name) => `'${String(name || "").replace(/'/g, "''")}'`;

const HEADER_ALIASES = {
  checked: ["centang", "check", "checked"],
  no: ["no", "nomor"],
  sku: ["sku", "barcode", "kode barang"],
  namaBarang: ["nama barang", "barang", "item name"],
  qty: ["qty", "quantity", "jumlah"],
  rakTujuan: ["rak tujuan", "rak", "tujuan"],
  lokasi: ["lokasi", "location"],
  stokBulky: ["stok bulky", "bulky"],
  stokRetail: ["stok retail", "retail"],
  status: ["status"],
  keterangan: ["keterangan", "note", "notes"]
};

const normalizeHeader = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const buildHeaderInfo = (rows) => {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex++) {
    const row = rows[rowIndex] || [];
    if (!row.length) continue;

    const columnMap = {};
    const normalizedHeaders = row.map(normalizeHeader);
    normalizedHeaders.forEach((header, colIndex) => {
      if (!header) return;
      for (const [fieldName, aliases] of Object.entries(HEADER_ALIASES)) {
        if (columnMap[fieldName] !== undefined) continue;
        if (aliases.includes(header)) {
          columnMap[fieldName] = colIndex;
          break;
        }
      }
    });

    const hasRequiredHeaders = ["sku", "namaBarang", "qty"].every((field) => columnMap[field] !== undefined);
    if (hasRequiredHeaders) {
      return {
        headerRowIndex: rowIndex,
        dataStartIndex: rowIndex + 1,
        columnMap
      };
    }
  }
  return null;
};

export { json, getAccessToken, escSheet, buildHeaderInfo };
