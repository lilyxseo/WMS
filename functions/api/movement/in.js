import { requirePicRole } from '../_authz.js';
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const INVENTORY_MOVEMENT_RANGE = "Movement!A:I";
const PRIMARY_SHEET_RANGE = "Barang Masuk!A:I";
const FALLBACK_SHEET_RANGE = "Barang Masuk!A:I";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function base64Url(input) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem) {
  const cleanPem = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(cleanPem);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function sanitize(value) {
  return String(value ?? "").trim();
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatDateMDYYYY(date = new Date()) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

export function isValidMovementDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isPermissionError(data) {
  const text = String(data?.error?.message || data?.message || "").toLowerCase();
  return text.includes("permission") || text.includes("forbidden") || text.includes("insufficient") || text.includes("caller does not have permission");
}

async function createAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = `${base64Url({ alg: "RS256", typ: "JWT" })}.${base64Url({
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  })}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(unsignedJwt));
  let binarySignature = "";
  new Uint8Array(signature).forEach((b) => (binarySignature += String.fromCharCode(b)));

  const jwt = `${unsignedJwt}.${btoa(binarySignature).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Gagal membuat access token");
  }
  return tokenData.access_token;
}


async function appendToSheet({ accessToken, sheetId, range, values }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}


async function batchUpdateSheetRows({ accessToken, sheetId, data }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  const body = await res.json().catch(() => ({}));
  return { res, data: body };
}

async function readSheetValues({ accessToken, sheetId, range }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function findFirstEmptyRowIndex(values) {
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const tanggal = sanitize(row[0]);
    const sku = sanitize(row[3]);
    if (!tanggal && !sku) return i;
  }
  return -1;
}

async function updateSheetRow({ accessToken, sheetId, range, values }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function readSpreadsheetMetadata({ accessToken, sheetId }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId,properties.title,sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function readSheetBarangMasuk({ accessToken, sheetId }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("Barang Masuk!A1:I5")}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function onRequestPost({ request, env }) {
  const authz = await requirePicRole({ request, env });
  if (!authz.ok) return authz.response;
  try {
    const inventorySpreadsheetId = sanitize(env.SHEET_ID_INVENTORY);
    const spreadsheetId = sanitize(env.SHEET_ID_2026);
    if (!inventorySpreadsheetId) return json({ success: false, message: "SHEET_ID_INVENTORY belum diset" }, 500);
    if (!spreadsheetId) return json({ success: false, message: "SHEET_ID_2026 belum diset" }, 500);
    if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) return json({ success: false, message: "Environment variable belum lengkap" }, 500);

    const body = await request.json();
    const requestItems = Array.isArray(body?.items) ? body.items : [body];
    if (!requestItems.length) return json({ success: false, message: "items wajib diisi" }, 400);

    const movementItems = requestItems.map((item) => {
      const sku = sanitize(item?.sku);
      const namaBarang = sanitize(item?.namaBarang);
      const qty = toPositiveNumber(item?.qty);
      const stokDiLokasiAwal = toNonNegativeNumber(item?.stokDiLokasiAwal);
      const stokAktual = toNonNegativeNumber(item?.stokAktual);
      const tanggal = sanitize(item?.tanggal);
      const [year, month, day] = tanggal.split("-").map(Number);
      const tanggalBarangMasuk = isValidMovementDate(tanggal)
        ? formatDateMDYYYY(new Date(year, month - 1, day))
        : "";
      const from = sanitize(item?.from);
      const to = sanitize(item?.to);
      const pic = sanitize(item?.pic) || "ABI";
      return { sku, namaBarang, qty, stokDiLokasiAwal, stokAktual, tanggal, tanggalBarangMasuk, from, to, pic };
    });

    for (const item of movementItems) {
      if (!isValidMovementDate(item.tanggal)) return json({ success: false, message: "tanggal harus berformat YYYY-MM-DD dan valid" }, 400);
      if (!item.from) return json({ success: false, message: "from wajib diisi" }, 400);
      if (!item.to) return json({ success: false, message: "to wajib diisi" }, 400);
      if (!item.sku) return json({ success: false, message: "sku wajib diisi" }, 400);
      if (!item.namaBarang) return json({ success: false, message: "namaBarang wajib diisi" }, 400);
      if (item.qty === null) return json({ success: false, message: "qty harus angka > 0" }, 400);
      if (item.stokDiLokasiAwal === null) return json({ success: false, message: "stokDiLokasiAwal harus angka >= 0" }, 400);
      if (item.stokAktual === null) return json({ success: false, message: "stokAktual harus angka >= 0" }, 400);
    }

    const accessToken = await createAccessToken(env);
    const inventoryRows = movementItems.map((item) => [item.tanggal, item.from, item.to, item.sku, item.namaBarang, item.stokDiLokasiAwal, item.stokAktual]);
    const barangMasukRows = movementItems.map((item) => [item.tanggalBarangMasuk, item.from, item.to, item.sku, item.namaBarang, item.qty, "Movement", item.pic, "INTERNAL STOCK TRANSFER"]);

    let inventoryWrite = await appendToSheet({ accessToken, sheetId: inventorySpreadsheetId, range: INVENTORY_MOVEMENT_RANGE, values: inventoryRows });
    if (!inventoryWrite.res.ok && isPermissionError(inventoryWrite.data)) {
      return json({ success: false, message: "Service account belum punya akses Editor ke Spreadsheet Inventory" }, 403);
    }
    if (!inventoryWrite.res.ok) return json({ success: false, message: inventoryWrite.data?.error?.message || "Gagal menulis history Movement", detail: inventoryWrite.data }, inventoryWrite.res.status);

    const readResult = await readSheetValues({ accessToken, sheetId: spreadsheetId, range: PRIMARY_SHEET_RANGE });
    let { res, data } = readResult;
    if (!res.ok && isPermissionError(data)) {
      return json({ success: false, message: "Service account belum punya akses Editor ke Spreadsheet 2026" }, 403);
    }
    if (!res.ok) return json({ success: false, message: data?.error?.message || "Gagal membaca Google Sheet", detail: data }, res.status);

    const values = Array.isArray(data?.values) ? data.values : [];
    const emptyIndex = findFirstEmptyRowIndex(values);
    const targetIndex = emptyIndex === -1 ? values.length : emptyIndex;
    const startRowNumber = Math.max(2, targetIndex + 1);
    const updateData = barangMasukRows.map((row, idx) => ({ range: `Barang Masuk!A${startRowNumber + idx}:I${startRowNumber + idx}`, values: [row] }));
    ({ res, data } = await batchUpdateSheetRows({ accessToken, sheetId: spreadsheetId, data: updateData }));

    if (!res.ok && isPermissionError(data)) {
      return json({ success: false, message: "Service account belum punya akses Editor ke Spreadsheet 2026" }, 403);
    }
    if (!res.ok) return json({ success: false, message: data?.error?.message || "Gagal update Google Sheet", detail: data }, res.status);
    return json({ success: true, processed: movementItems.length });
  } catch (err) {
    return json({ success: false, message: err?.message || "Internal server error" }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const mode = sanitize(url.searchParams.get("mode")).toLowerCase();
    if (mode !== "test") return new Response("API OK", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });

    if (sanitize(env.MOVEMENT_TEST_MODE) !== "1") return json({ success: false, message: "Mode test tidak aktif" }, 403);

    const inventorySpreadsheetId = sanitize(env.SHEET_ID_INVENTORY);
    const spreadsheetId = sanitize(env.SHEET_ID_2026);
    if (!inventorySpreadsheetId) return json({ success: false, message: "SHEET_ID_INVENTORY belum diset" }, 500);
    if (!spreadsheetId) return json({ success: false, message: "SHEET_ID_2026 belum diset" }, 500);
    if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) return json({ success: false, message: "Environment variable belum lengkap" }, 500);

    const accessToken = await createAccessToken(env);
    const metadata = await readSpreadsheetMetadata({ accessToken, sheetId: spreadsheetId });
    if (!metadata.res.ok && isPermissionError(metadata.data)) {
      return json({ success: false, message: "Service account belum punya akses Editor ke Spreadsheet 2026" }, 403);
    }
    if (!metadata.res.ok) return json({ success: false, message: metadata.data?.error?.message || "Gagal baca metadata spreadsheet", detail: metadata.data }, metadata.res.status);

    const sheetRead = await readSheetBarangMasuk({ accessToken, sheetId: spreadsheetId });
    if (!sheetRead.res.ok && isPermissionError(sheetRead.data)) {
      return json({ success: false, message: "Service account belum punya akses Editor ke Spreadsheet 2026" }, 403);
    }
    if (!sheetRead.res.ok) return json({ success: false, message: sheetRead.data?.error?.message || "Gagal baca sheet Barang Masuk", detail: sheetRead.data }, sheetRead.res.status);

    const appendDummy = sanitize(url.searchParams.get("appendDummy")).toLowerCase() === "1";
    let appendResult = { skipped: true };
    if (appendDummy) {
      const dummyRow = [[new Date().toISOString(), "TEST_FROM", "TEST_TO", "TEST_SKU", "TEST_BARANG", 1, "Movement", "ABI", "INTERNAL STOCK TRANSFER"]];
      const appended = await updateSheetRow({ accessToken, sheetId: spreadsheetId, range: "Barang Masuk!A2:I2", values: dummyRow });
      if (!appended.res.ok && isPermissionError(appended.data)) {
        return json({ success: false, message: "Service account belum punya akses Editor ke Spreadsheet 2026" }, 403);
      }
      if (!appended.res.ok) return json({ success: false, message: appended.data?.error?.message || "Gagal append dummy row", detail: appended.data }, appended.res.status);
      appendResult = { skipped: false, success: true };
    }

    return json({
      success: true,
      spreadsheetId,
      metadataTitle: metadata.data?.properties?.title || "",
      hasBarangMasukSheet: Array.isArray(metadata.data?.sheets) && metadata.data.sheets.some((s) => sanitize(s?.properties?.title).toLowerCase() === "barang masuk"),
      readRows: Array.isArray(sheetRead.data?.values) ? sheetRead.data.values.length : 0,
      appendDummy: appendResult,
    });
  } catch (err) {
    return json({ success: false, message: err?.message || "Internal server error" }, 500);
  }
}
