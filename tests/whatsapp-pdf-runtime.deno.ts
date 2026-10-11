import { extractPdf } from '../supabase/functions/whatsapp-fonnte/pdf-runtime.js';
import { parsePdfPages } from '../supabase/functions/whatsapp-fonnte/pdf-document.js';
import { buildPdf, transferPages } from './fixtures/whatsapp-pdf.mjs';

Deno.test('Edge PDF runtime reads a real PDF and preserves leading-zero SKU and transfer number', async () => {
  const pages = await extractPdf(buildPdf());
  const parsed = parsePdfPages(pages);
  if (parsed.header.transferNumber !== '#T-007894' || parsed.rows.length !== 2 || parsed.rows[0].sku !== '0000' || parsed.rows[0].namaProduk !== 'MERLYN WHITE 0' || parsed.rows[1].qty !== 2) throw new Error('PDF extraction mismatch');
});

Deno.test('Edge PDF runtime extracts multiple pages without browser or native canvas', async () => {
  const pages = await extractPdf(buildPdf([...transferPages(), ...transferPages({ transfer: '#T-007894' })]));
  if (pages.length !== 2 || !pages.every(page => page.some((item: { str: string }) => item.str.includes('0000')))) throw new Error('Missing page text');
  if (parsePdfPages(pages).rows.length !== 4) throw new Error('Items lost across page totals');
});

Deno.test('Edge PDF runtime rejects corrupt documents and documents beyond the page limit', async () => {
  for (const bytes of [new TextEncoder().encode('%PDF-invalid'), buildPdf(Array.from({length:41},()=>[]))]) {
    let rejected = false;
    try { await extractPdf(bytes); } catch { rejected = true; }
    if (!rejected) throw new Error('Invalid PDF unexpectedly accepted');
  }
});
