import { groupPdfItemsByRows, pdfRowsToCsvRows, textRowsToTransferCsvRows, parseTransferCsvRows, cleanupTransferHeaderValue, detectPdfTableColumns } from './pdf-transfer-parser.js';

export class PdfError extends Error {}
export const MAX_PDF_BYTES = 8 * 1024 * 1024;
function pdfTextReference(payload) {
  const text = typeof payload.message === 'string' ? payload.message.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').trim() : '';
  // Explicit search commands remain searches, even when their query ends in .pdf.
  if (/^(?:cari|sku|barang|nama|lokasi|masuk|keluar|detail|ringkasan|movement|inbound|outbound|outbount|edit|import|cek)\s/i.test(text)) return undefined;
  if (/^https:\/\/\S+$/i.test(text)) {
    try {
      const url = new URL(text);
      if (/(?:\.|%2e)pdf$/i.test(url.pathname)) return { url: text };
    } catch { /* Not a PDF link; continue checking a filename. */ }
    return undefined;
  }
  const filename = text.replace(/^(?:📄\s*)?(?:dokumen|document|file)\s*:\s*/i,'').trim();
  return filename.length <= 200 && /^[^\r\n\/\\<>]+\.pdf$/i.test(filename) ? { filename } : undefined;
}
function mediaInfo(payload) {
  const string = value => typeof value === 'string' ? value.trim() : '';
  const textReference = pdfTextReference(payload);
  const nested = [payload.document, payload.file, payload.media].filter(value => value && typeof value === 'object' && !Array.isArray(value));
  const url = [payload.url, payload.file_url, payload.fileUrl, payload.media_url, ...nested.map(value => value.url), typeof payload.file === 'string' ? payload.file : '', textReference?.url].map(string).find(Boolean) || '';
  const filename = [payload.filename, payload.fileName, payload.file_name, ...nested.flatMap(value => [value.filename, value.fileName]), textReference?.filename].map(string).find(Boolean) || '';
  const extension = string(payload.extension).replace(/^\./, '').toLowerCase();
  const types = [payload.type, payload.mime, payload.mimetype, payload.mimeType, payload.messageType, ...nested.flatMap(value => [value.type, value.mimetype, value.mimeType])].map(string);
  const pdf = extension === 'pdf' || /\.pdf$/i.test(filename) || types.some(value => /^application\/pdf(?:\s*;|$)/i.test(value)) || /(?:\.|%2e)pdf(?:\?|#|$)/i.test(url);
  const document = types.some(value => /^(document|file|documentMessage)$/i.test(value)) || [payload.document, payload.file].some(value => value && typeof value === 'object' && !Array.isArray(value));
  const other = Boolean(extension && extension !== 'pdf') || /\.(?:jpe?g|png|webp|gif|mp[34]|ogg|wav|xlsx?|docx?|zip)$/i.test(filename) || types.some(value => /^(?:image|audio|video)(?:\/|$)/i.test(value));
  return { url, filename: filename.slice(0,200), pdf, document, other, pdfTextHint: Boolean(textReference) };
}

export function isDocumentPayload(payload) {
  const media = mediaInfo(payload);
  return media.pdf || media.document;
}

export function pdfAttachment(payload, allowUnknown = false) {
  const media = mediaInfo(payload);
  // Fonnte may supply a signed URL without an extension or MIME metadata.
  // This is only a candidate: downloadPdf still validates the actual PDF bytes.
  return media.url && (media.pdf || media.document || allowUnknown || !media.other)
    ? { url: media.url, filename: media.filename } : undefined;
}

export function pdfMediaStatus(payload) {
  const media = mediaInfo(payload);
  const knownFields = ['url','file_url','fileUrl','media_url','filename','fileName','file_name','extension','type','mime','mimetype','mimeType','messageType','document','file','media'];
  return {
    receivedAt: new Date().toISOString(), hasDownloadUrl: Boolean(media.url), hasFilename: Boolean(media.filename),
    documentDetected: media.pdf || media.document, pdfTextHint: media.pdfTextHint, hasExtension: typeof payload.extension === 'string' && Boolean(payload.extension.trim()),
    fields: [...knownFields.filter(key => Object.hasOwn(payload,key)), ...(media.pdfTextHint ? ['message'] : [])],
  };
}

function attachmentUrl(value, env) {
  let url;
  try { url = new URL(value); } catch { throw new PdfError('URL dokumen tidak valid. Kirim PDF sebagai dokumen WhatsApp.'); }
  const extra = String(env.WHATSAPP_PDF_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  const host = url.hostname.toLowerCase();
  const allowed = host === 'fonnte.com' || host.endsWith('.fonnte.com') || extra.includes(host);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !allowed || /^[\d.]+$/.test(host) || host.includes(':')) {
    throw new PdfError('Host dokumen belum diizinkan. Kirim dokumen melalui Fonnte atau minta admin mengatur WHATSAPP_PDF_ALLOWED_HOSTS.');
  }
  return url.href;
}

export async function downloadPdf(attachment, env, fetchFn) {
  let url = attachmentUrl(attachment.url, env);
  const signal = AbortSignal.timeout(20000);
  try {
    for (let redirects = 0; redirects <= 2; redirects++) {
      const response = await fetchFn(url, { redirect: 'manual', signal });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (!location || redirects === 2) throw new PdfError('Tautan PDF terlalu banyak dialihkan. Kirim ulang dokumen.');
        url = attachmentUrl(new URL(location, url).href, env);
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) throw new PdfError('PDF belum dapat diunduh atau tautannya kedaluwarsa. Kirim ulang dokumen.');
      if (Number(response.headers.get('Content-Length')) > MAX_PDF_BYTES) {
        await response.body?.cancel(); throw new PdfError('PDF maksimal 8 MB. Pisahkan dokumen terlebih dahulu.');
      }
      if (!response.body) throw new PdfError('Dokumen PDF kosong.');
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > MAX_PDF_BYTES) throw new PdfError('PDF maksimal 8 MB. Pisahkan dokumen terlebih dahulu.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new PdfError('Isi dokumen bukan PDF. Kirim file PDF asli.');
      return bytes;
    }
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError('Unduhan PDF gagal. Kirim ulang dokumen untuk mencoba lagi.');
  }
}

export function transferName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 100 || /[\\/:?*\[\]\u0000-\u001f]/.test(name)) throw new PdfError('Nomor transfer wajib diisi, maksimal 100 karakter tanpa \\ / : ? * [ ].');
  return name;
}

export function validateTransferRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new PdfError('Import harus berisi 1–1.000 baris. Pisahkan PDF yang lebih besar.');
  return rows.map((row, index) => {
    const sku = String(row.sku || '').trim(), name = String(row.namaProduk || '').trim();
    if (!sku || !name || sku.length > 200 || name.length > 1000 || row.qty === '' || row.qty == null || !Number.isFinite(Number(row.qty)) || Number(row.qty) < 0) {
      throw new PdfError(`Item ${index + 1} belum valid. SKU, nama produk, dan qty 0 atau lebih wajib diisi.`);
    }
    return { ...row, sku, namaProduk: name, qty: Number(row.qty) };
  });
}

export function parsePdfPages(pages) {
  const pageRows = pages.map(groupPdfItemsByRows), pdfRows = pageRows.flat();
  const textRows = pdfRows.map(row => row.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!textRows.length) throw new PdfError('PDF tidak memiliki teks yang dapat dibaca. PDF hasil scan memerlukan OCR; gunakan PDF asli atau import di aplikasi.');
  const items = [], warnings = new Set();
  let tableHeader = [];
  for (let page = 0; page < pageRows.length; page++) {
    const lines = pageRows[page].map(row => row.items.map(item => item.str).join(' ').replace(/\s+/g,' ').trim());
    const detected = detectPdfTableColumns(pageRows[page]);
    if (detected.headerRowIndex >= 0) tableHeader = pageRows[page].slice(0,detected.headerRowIndex + 1);
    let csvRows = pdfRowsToCsvRows(detected.headerRowIndex >= 0 ? pageRows[page] : [...tableHeader,...pageRows[page]]);
    if (!csvRows.length) csvRows = textRowsToTransferCsvRows(lines);
    let parsed = parseTransferCsvRows(csvRows);
    if (!parsed.items.length && !parsed.failedRows.length) parsed = parseTransferCsvRows(textRowsToTransferCsvRows(lines));
    if (parsed.failedRows.length) throw new PdfError(`Halaman ${page + 1}: ${parsed.failedRows.length} baris PDF gagal dibaca. Import dibatalkan agar tidak ada item terlewat. Perbaiki dokumen atau gunakan preview di aplikasi.`);
    if (tableHeader.length && !parsed.items.length && detected.headerRowIndex < 0 && lines.some(line => line && !/^(total|grand total|halaman|page|disiapkan|dikirimkan|diterima oleh|status transfer)\b/i.test(line))) {
      throw new PdfError(`Tabel pada halaman ${page + 1} tidak dapat dikenali. Periksa dokumen di aplikasi sebelum import.`);
    }
    items.push(...parsed.items); parsed.warnings.forEach(warning => warnings.add(warning));
  }
  const rows = validateTransferRows(items);
  const find = label => {
    const pattern = new RegExp(`^(?:${label})\\s*[:\\-]?\\s*(.+)$`, 'i');
    const hit = textRows.slice(0, 30).find(row => pattern.test(row));
    return hit?.match(pattern)?.[1]?.trim() || '';
  };
  const top = textRows.slice(0, 20).find(row => /(?:transfer|nomor transfer|no transfer).*#?T-\d+/i.test(row));
  return { rows, header: { transferNumber: top?.match(/#?T-\d+/i)?.[0] || '', from: cleanupTransferHeaderValue(find('Dari')), to: cleanupTransferHeaderValue(find('Kepada')), referenceNumber: find('Nomor Referensi|No Referensi|Reference') }, warnings: [...warnings] };
}
