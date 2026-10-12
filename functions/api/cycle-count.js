import { getRequestRole, requirePicRole } from './_authz.js';
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEET_RANGE = "Cycle Count!A4:G";
const HISTORY_RANGE = "Cycle Count!A4:G";
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;

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

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedJwt)
  );

  let binarySignature = "";
  new Uint8Array(signature).forEach((b) => {
    binarySignature += String.fromCharCode(b);
  });

  const jwt = `${unsignedJwt}.${btoa(binarySignature)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")}`;

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

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatTanggal(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function validateItem(item, index) {
  const lokasi = String(item?.lokasi || "").trim();
  const sku = String(item?.sku || "").trim();
  const namaBarang = String(item?.nama_barang || item?.namaBarang || "").trim();
  const stok = toNumberOrNull(item?.stok);
  const aktual = toNumberOrNull(item?.aktual);
  const catatan = String(item?.catatan || "").trim();

  if (!sku) return { error: `items[${index}].sku wajib diisi` };
  if (!lokasi) return { error: `items[${index}].lokasi wajib diisi` };
  if (stok === null) return { error: `items[${index}].stok wajib angka` };
  if (aktual === null) return { error: `items[${index}].aktual wajib angka` };

  return {
    value: {
      lokasi,
      sku,
      nama_barang: namaBarang,
      stok,
      aktual,
      catatan,
    },
  };
}

export async function onRequestPost({ request, env }) {
  const authz = await requirePicRole({ request, env });
  if (!authz.ok) return authz.response;
  try {
    const SHEET_MAP = {
      cycle_count: env.SHEET_ID_INVENTORY,
    };
    const sheetId = SHEET_MAP["cycle_count"];

    if (!sheetId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Sheet tidak ditemukan",
        }),
        { status: 400 }
      );
    }

    if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
      return json({ success: false, message: "Environment variable belum lengkap" }, 500);
    }

    const body = await request.json();
    const tanggal = String(body?.tanggal || formatTanggal(new Date())).trim();
    const items = body?.items;

    if (!Array.isArray(items)) return json({ success: false, message: "items wajib array" }, 400);
    if (!items.length) return json({ success: false, message: "items tidak boleh kosong" }, 400);

    const validated = [];
    for (let i = 0; i < items.length; i++) {
      const result = validateItem(items[i], i);
      if (result.error) return json({ success: false, message: result.error }, 400);
      validated.push(result.value);
    }

    const accessToken = await createAccessToken(env);
    const rows = validated.map((item) => [
      tanggal,
      item.lokasi,
      item.sku,
      item.nama_barang,
      item.stok,
      item.aktual,
      item.catatan,
    ]);

    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}` +
      `/values/${encodeURIComponent(SHEET_RANGE)}:append?valueInputOption=USER_ENTERED`;

    const sheetRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: rows }),
    });

    const result = await sheetRes.json();
    if (!sheetRes.ok) {
      return json({ success: false, message: result.error?.message || "Gagal append ke Google Sheet", detail: result }, sheetRes.status);
    }

    return json({ success: true, message: "Cycle count berhasil disimpan", total_items: rows.length, result });
  } catch (err) {
    return json({ success: false, message: err?.message || "Internal server error" }, 500);
  }
}

function historyTimestamp(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapCycleCountHistory(values = []) {
  return values.map((row, index) => ({
    tanggal: String(row?.[0] || ''),
    lokasi: String(row?.[1] || ''),
    sku: String(row?.[2] || ''),
    nama_barang: String(row?.[3] || ''),
    stok: toNumberOrNull(row?.[4]) ?? 0,
    aktual: toNumberOrNull(row?.[5]) ?? 0,
    catatan: String(row?.[6] || ''),
    rowNumber: index + 4,
  })).filter(row => row.tanggal || row.lokasi || row.sku || row.nama_barang)
    .sort((a, b) => historyTimestamp(b.tanggal) - historyTimestamp(a.tanggal) || b.rowNumber - a.rowNumber);
}

export async function onRequestGet({ request, env }) {
  const role = await getRequestRole(request, env);
  if (!role) return json({ success: false, message: 'Sesi tidak valid untuk membaca history cycle count' }, 401);
  try {
    if (!env.SHEET_ID_INVENTORY) return json({ success: false, message: 'Sheet tidak ditemukan' }, 500);
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_HISTORY_LIMIT), 10) || DEFAULT_HISTORY_LIMIT));
    const accessToken = await createAccessToken(env);
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_INVENTORY}/values/${encodeURIComponent(HISTORY_RANGE)}`;
    const sheetRes = await fetch(sheetUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const sheetData = await sheetRes.json().catch(() => ({}));
    if (!sheetRes.ok) return json({ success: false, message: sheetData?.error?.message || 'Gagal membaca history cycle count' }, 502);
    const allRows = mapCycleCountHistory(sheetData.values || []);
    const start = (page - 1) * limit;
    return json({ rows: allRows.slice(start, start + limit), total: allRows.length, page, limit });
  } catch (err) {
    return json({ success: false, message: err?.message || 'Gagal membaca history cycle count' }, 500);
  }
}
