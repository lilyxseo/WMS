import { getGoogleAccessToken } from './_google-auth.js';
import { requirePicRole } from './_authz.js';
const SHEET_RANGE = "Sheet1!A:G";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function createAccessToken(env) { return getGoogleAccessToken(env); }

export async function onRequestGet() {
  return new Response("API OK", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function onRequestPost({ request, env }) {
  const authz = await requirePicRole({ request, env });
  if (!authz.ok) return authz.response;
  try {
    if (!env.GOOGLE_SHEET_ID) {
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
