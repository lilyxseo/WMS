import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/css/pages.css', import.meta.url), 'utf8');

function pageMarkup(id) {
  const start = html.indexOf(`<section id="${id}"`);
  assert.notEqual(start, -1, `missing ${id}`);
  const next = html.indexOf('<section id="page-', start + 1);
  return html.slice(start, next);
}

test('transaction pages use the compact title, actions, search, table structure', () => {
  for (const [id, mode, searchId] of [
    ['page-barang-masuk', 'in', 'inSearch'],
    ['page-barang-keluar', 'out', 'outSearch'],
  ]) {
    const page = pageMarkup(id);
    const title = page.indexOf('class="page-title"');
    const action = page.indexOf(`data-mv-action="export" data-mv-mode="${mode}"`);
    const search = page.indexOf(`id="${searchId}"`);
    const results = page.indexOf(`id="${mode}Results"`);
    assert.ok(title < action && action < search && search < results);
    assert.doesNotMatch(page, /refresh/i);
    assert.doesNotMatch(page, /summary-card|dashboard-section/);
  }
});

test('transaction renderers retain canonical table columns and presentation helpers', () => {
  assert.match(js, /const BARANG_MASUK_PRESENTATION_COLUMNS=\[\.\.\.TRANSACTION_PRESENTATION_COLUMNS,"no_iseller","netsuite","keterangan_lainnya","lokasi_surat_jalan","stockout","dokumen"\]/);
  assert.match(js, /const BARANG_KELUAR_PRESENTATION_COLUMNS=\[\.\.\.TRANSACTION_PRESENTATION_COLUMNS,"no_iseller","netsuite","keterangan_lainnya","status_lanjutan","lokasi_surat_jalan","no_iseller_awal","dokumen"\]/);
  assert.match(js, /renderDocumentValue\(r\?\._rawCells\?\.\[c\]\)/);
  assert.match(js, /renderPresentationValue\(c,r\?\._rawCells\?\.\[c\]\)/);
  assert.doesNotMatch(js, /summaryEl\.innerHTML/);
});

test('mobile transaction data remains a horizontally scrollable table', () => {
  assert.match(css, /\.transaction-page \.table-wrap-full\{[^}]*overscroll-behavior-x:contain[^}]*-webkit-overflow-scrolling:touch/);
  assert.match(css, /@media\(max-width:699px\)[\s\S]*?\.transaction-page \.table-wrap-full\{[^}]*overflow-x:auto/);
  assert.match(css, /\.transaction-page \.table-wrap-full table\{min-width:1900px\}/);
  assert.match(css, /\.transaction-page \.table-wrap-full thead th\{[^}]*position:sticky/);
  assert.doesNotMatch(css, /\.transaction-page[^}]+thead\{display:none/);
});
