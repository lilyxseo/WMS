import { normalizeDate, normalizeNumber, normalizeLocation, normalizeSku, normalizeText } from './sheet-normalization.js';
const FIELD_ORDER = ['tanggal', 'from_location', 'to_location', 'sku', 'nama_barang', 'qty', 'status', 'pic', 'keterangan'];
const clean = value => String(value ?? '').trim();
function canonical(field, value) {
  if (field === 'tanggal') return normalizeDate(value).value;
  if (field === 'qty') return normalizeNumber(value).value;
  if (field === 'sku') return normalizeSku(value);
  if (field === 'from_location' || field === 'to_location') return normalizeLocation(value);
  return normalizeText(value);
}
const b64 = data => btoa(typeof data === 'string' ? data : JSON.stringify(data)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function googleToken(env, fetchFn) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: env.GOOGLE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })}`;
  const pem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), ch => ch.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const response = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64(String.fromCharCode(...signature))}` }), signal: AbortSignal.timeout(10000) });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error('Google authentication failed');
  return payload.access_token;
}

export async function commitSheetEdit(env, config, state, fetchFn) {
  const access = await googleToken(env, fetchFn);
  const sheet = state.source === 'Barang Masuk' ? 'Barang Masuk' : 'Barang KeIuar';
  const table = state.source === 'Barang Masuk' ? 'inventory_barang_masuk' : 'inventory_barang_keluar';
  const rowNumber = Number(state.row.source_row_number);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('Invalid source row');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID_2026)}`;
  const headerRead = await fetchFn(`${url}/values/${encodeURIComponent(`'${sheet}'!A1:I1`)}`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10000) });
  if (!headerRead.ok) throw new Error('Sheet header read failed');
  const header = (await headerRead.json()).values?.[0] || [];
  const expected = ['TANGGAL', 'FROM', 'TO', 'SKU', 'NAMABARANG', 'QTY', 'STATUS', 'PIC', 'KETERANGAN'];
  if (expected.some((field, i) => String(header[i] || '').toUpperCase().replace(/\s/g, '') !== field)) return 'Susunan kolom spreadsheet tidak sesuai WMS. Tidak ada perubahan disimpan. Hubungi admin.';
  const read = await fetchFn(`${url}/values/${encodeURIComponent(`'${sheet}'!A${rowNumber}:I${rowNumber}`)}?valueRenderOption=FORMATTED_VALUE`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10000) });
  if (!read.ok) throw new Error('Sheet read failed');
  const values = (await read.json()).values?.[0] || [];
  if (FIELD_ORDER.some((field, index) => clean(canonical(field, values[index])) !== clean(canonical(field, state.row[field])))) {
    return 'Data sudah berubah atau belum tersinkron. Tidak ada perubahan disimpan. Cari ulang transaksi setelah sinkronisasi WMS.';
  }
  const data = Object.entries(state.updates).map(([field, value]) => ({ range: `'${sheet}'!${String.fromCharCode(65 + FIELD_ORDER.indexOf(field))}${rowNumber}`, values: [[value]] }));
  const write = await fetchFn(`${url}/values:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'RAW', data }), signal: AbortSignal.timeout(10000) });
  if (!write.ok) throw new Error('Sheet write failed or uncertain');
  // The source sheet is authoritative; its normal sync remains able to repair the mirror.
  try {
    const mirror = await fetchFn(`${config.url}/rest/v1/${table}?source_row_number=eq.${rowNumber}`, { method: 'PATCH', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(state.updates), signal: AbortSignal.timeout(10000) });
    if (!mirror.ok || (await mirror.json()).length !== 1) throw new Error('Mirror update failed');
  } catch { return 'Perubahan tersimpan di Google Sheets. Pembaruan Supabase belum terkonfirmasi; tunggu sinkronisasi WMS lalu cari ulang.'; }
  return '✅ Perubahan berhasil disimpan di Google Sheets dan Supabase. Kirim pencarian untuk melihat data terbaru.';
}
