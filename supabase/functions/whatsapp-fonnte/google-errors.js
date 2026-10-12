export class GoogleAccessError extends Error {
  constructor(code, userMessage, writeAttempted = false, message = 'Google request failed') {
    super(message); this.code = code; this.userMessage = userMessage; this.writeAttempted = writeAttempted;
  }
}
export async function googleResponseError(response, writeAttempted = false, spreadsheetSecret = 'SHEET_ID_2026') {
  const payload = await response.json().catch(() => ({}));
  const reasons = [payload.error?.status, ...(payload.error?.details || []).map(detail => detail.reason), ...(payload.error?.errors || []).map(error => error.reason)];
  const rawMessage = String(payload.error?.message || '');
  if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured')) return new GoogleAccessError('SHEETS_API_DISABLED', 'Google Sheets API belum aktif pada project OAuth. Aktifkan Google Sheets API di Google Cloud.', writeAttempted);
  if (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || reasons.includes('insufficientPermissions')) return new GoogleAccessError('SHEETS_SCOPE_MISSING', 'Izin OAuth Google Sheets belum tersedia. Authorize ulang dengan scope https://www.googleapis.com/auth/spreadsheets.', writeAttempted);
  if (response.status === 401) return new GoogleAccessError('GOOGLE_AUTH_REJECTED', 'Google menolak token akses. Periksa konfigurasi OAuth Gmail dan otorisasi ulang jika diperlukan.', writeAttempted);
  if (response.status === 403) return new GoogleAccessError('SHEETS_PERMISSION_DENIED', writeAttempted ? 'Google menolak izin menulis. Pastikan Gmail OAuth memiliki akses Editor dan tab tujuan tidak dilindungi dari akun tersebut.' : 'Google menolak akses spreadsheet. Pastikan Gmail yang diotorisasi memiliki akses ke spreadsheet tujuan.', writeAttempted);
  if (response.status === 404) return new GoogleAccessError('SPREADSHEET_NOT_FOUND', `Spreadsheet tidak ditemukan atau tidak dapat diakses. Periksa ${spreadsheetSecret} dan akses Gmail; secret harus berisi ID saja, bukan URL lengkap.`, writeAttempted);
  if (response.status === 400 && /exceeds? grid limits|outside.*grid|beyond.*grid/i.test(rawMessage)) return new GoogleAccessError('SHEETS_GRID_LIMIT', 'Range baca melewati batas baris atau kolom tab Google Sheets.', writeAttempted);
  if ([400, 413].includes(response.status) && /exceed.*(?:maximum|limit|size)|too large|too much data|response.*size/i.test(rawMessage)) return new GoogleAccessError('SHEETS_READ_TOO_LARGE', 'Data Google Sheets terlalu besar untuk dibaca dalam satu permintaan.', writeAttempted);
  if (response.status === 400 && /unable to parse range|invalid range/i.test(rawMessage)) return new GoogleAccessError('SHEET_TAB_MISSING', 'Nama tab atau range tidak ditemukan. Pastikan tab Kartu Stock, Barang Masuk, dan Barang KeIuar tersedia dengan ejaan yang sesuai WMS.', writeAttempted);
  if (response.status === 429) return new GoogleAccessError('GOOGLE_RATE_LIMIT', 'Batas permintaan Google tercapai. Tunggu beberapa saat sebelum mencoba pemeriksaan lagi.', writeAttempted);
  return new GoogleAccessError(`GOOGLE_HTTP_${response.status}`, `Google mengembalikan HTTP ${response.status}. Periksa konfigurasi atau coba cek google nanti.`, writeAttempted);
}
export function formatGoogleFailure(error, reference, sheet) {
  const known = error instanceof GoogleAccessError;
  const noWrite = known && !error.writeAttempted;
  const certainty = noWrite ? 'Tidak ada transaksi ditulis ke Google Sheets.' : `Status penulisan belum terkonfirmasi. Jangan mengulang sebelum memeriksa ${sheet} di WMS.`;
  return `${known ? error.userMessage : 'Penyimpanan gagal atau belum terkonfirmasi.'}\n${certainty}\n${known ? `Kode: ${error.code}` : ''}${reference ? `\nReferensi: ${reference}` : ''}`;
}
