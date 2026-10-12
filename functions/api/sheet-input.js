import { requirePicRole } from './_authz.js';
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEET_RANGE = "Sheet1!A:G";

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

  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function pemToArrayBuffer(pem) {
  const cleanPem = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = atob(cleanPem);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function createAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64Url(header);
  const encodedPayload = base64Url(payload);
  const unsignedJwt = `${encodedHeader}.${encodedPayload}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
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

  const encodedSignature = btoa(binarySignature)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${unsignedJwt}.${encodedSignature}`;

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
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

export async function onRequestGet() {
  return new Response("API OK", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
      return json({
        success: false,
        message: "Environment variable belum lengkap",
      }, 500);
    }

    const body = await request.json();

    const tanggal = body.tanggal || new Date().toISOString().slice(0, 10);
    const sku = String(body.sku || "").trim();
    const namaBarang = String(body.nama_barang || "").trim();
    const qty = body.qty;
    const lokasi = String(body.lokasi || "").trim();
    const keterangan = String(body.keterangan || "").trim();

    if (!sku || !namaBarang || qty === "" || qty === null || qty === undefined || !lokasi) {
      return json({
        success: false,
        message: "SKU, nama barang, qty, dan lokasi wajib diisi",
      }, 400);
    }

    const accessToken = await createAccessToken(env);

    const row = [
      tanggal,
      sku,
      namaBarang,
      qty,
      lokasi,
      keterangan,
      new Date().toISOString(),
    ];

    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}` +
      `/values/${encodeURIComponent(SHEET_RANGE)}:append?valueInputOption=USER_ENTERED`;

    const sheetRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [row],
      }),
    });

    const result = await sheetRes.json();

    if (!sheetRes.ok) {
      return json({
        success: false,
        message: result.error?.message || "Gagal append ke Google Sheet",
        detail: result,
      }, sheetRes.status);
    }

    return json({
      success: true,
      message: "Data berhasil disimpan",
      result,
    });
  } catch (err) {
    return json({
      success: false,
      message: err.message || "Internal server error",
    }, 500);
  }
}
