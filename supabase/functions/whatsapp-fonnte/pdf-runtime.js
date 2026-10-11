import { getDocument } from 'npm:pdfjs-dist@4.6.82/build/pdf.mjs';
import { WorkerMessageHandler } from 'npm:pdfjs-dist@4.6.82/build/pdf.worker.mjs';

// The Edge runtime has no Web Worker: use PDF.js' in-process worker implementation.
globalThis.pdfjsWorker = { WorkerMessageHandler };

export async function extractPdf(bytes) {
  const task = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 40) throw new Error('PDF maksimal 40 halaman. Pisahkan dokumen terlebih dahulu.');
    const pages = [];
    let total = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      total += content.items.length;
      if (total > 100000) throw new Error('Teks PDF terlalu besar. Pisahkan dokumen terlebih dahulu.');
      pages.push(content.items.filter(item => typeof item.str === 'string'));
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
