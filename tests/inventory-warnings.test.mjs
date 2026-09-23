import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventoryWarnings, loadInventoryWarnings, queryInventoryWarnings } from '../functions/api/_inventory-warnings.js';
import { readFile } from 'node:fs/promises';

const base = () => ({ kartuStok: [], rpl: [], bulky: [], barangMasuk: [], barangKeluar: [] });
const has = (rows, category) => rows.some(row => row.category === category);

test('complete warning rules avoid known false positives and preserve evidence', () => {
  const rows = base();
  rows.barangMasuk.push({ sku: ' BOTH ', nama_barang: 'GOTO Pen', tanggal: '9/22/2026', qty: 0 });
  rows.barangKeluar.push({ sku: 'both', nama_barang: 'goto   pen', tanggal: '2026-09-22', qty: 1 }, { sku: 'ONLY-OUT', nama_barang: 'Other', tanggal: '32/13/2026', qty: 'x' });
  rows.kartuStok.push({ sku: 'LOC', nama_barang: 'Located', lokasi_bulky: 'MASIH DI INBOUND', stok_akhir: 2 }, { sku: 'EMPTY-LOC', nama_barang: 'Lost', lokasi_bulky: ' ', stok_akhir: 3 }, { sku: 'MINUS', nama_barang: 'Minus', lokasi_bulky: 'A01-1', stok_akhir: -2 });
  rows.bulky.push({ sku: 'ACC', nama_barang: 'Accuracy', lokasi_bulky: 'A01-1', stok_akhir: 1, netsuite: null, selisih: 2 });
  const warnings = buildInventoryWarnings(rows);
  assert.equal(warnings.filter(row => row.category === 'OUTBOUND_WITHOUT_INBOUND').length, 1);
  assert.equal(warnings.some(row => row.category === 'OUTBOUND_WITHOUT_INBOUND' && row.sku.toUpperCase() === 'BOTH'), false);
  assert.equal(warnings.some(row => row.category === 'NAME_MISMATCH' && row.sku.toUpperCase() === 'BOTH'), false);
  assert.equal(warnings.some(row => row.category === 'EMPTY_LOCATION' && row.sku === 'LOC'), false);
  for (const category of ['EMPTY_LOCATION','NEGATIVE_STOCK','ACCURACY_MISMATCH']) assert.equal(has(warnings, category), true);
  assert.equal(has(warnings, 'MISSING_NETSUITE'), false, 'NETSUITE is an optional BULKY header');
  assert.ok(warnings.every(row => row.evidence && row.recommendation));
});

test('material name conflict, blank SKU and accuracy aggregation are deterministic', () => {
  const rows = base();
  rows.rpl.push({ sku: 'ABC', nama_barang: 'First name', selisih: 2 }, { sku: null, nama_barang: 'No sku', selisih: 0 });
  rows.bulky.push({ sku: ' abc ', nama_barang: 'Second name', netsuite: 10, selisih: -2 });
  const warnings = buildInventoryWarnings(rows);
  assert.equal(has(warnings, 'NAME_MISMATCH'), true);
  assert.equal(has(warnings, 'EMPTY_SKU'), true);
  assert.equal(has(warnings, 'ACCURACY_MISMATCH'), false, 'offsetting differences match shared accuracy aggregation');
});

test('backend query performs multi-word search, filters, stable sorting and pagination', () => {
  const warnings = [{ id:'2',severity:'Medium',category:'X',categoryLabel:'Zulu',source:'BULKY',sku:'B2',namaBarang:'Blue Pen',issue:'Missing reference',location:'A01',evidence:'NETSUITE NULL' },{ id:'1',severity:'High',category:'Y',categoryLabel:'Alpha',source:'RPL',sku:'A1',namaBarang:'Red Pen',issue:'Negative stock',location:'B01',evidence:'stock -1' }];
  const result = queryInventoryWarnings(warnings, { search:'red negative', severity:'High', sort:'sku', page:1, limit:1 });
  assert.equal(result.total, 1); assert.equal(result.rows[0].sku, 'A1');
});

test('analytics query matches the deployed RPL schema and does not force a select-all retry', async () => {
  const source = await readFile(new URL('../functions/api/_inventory-analytics.js', import.meta.url), 'utf8');
  const rpl = source.match(/rpl:\s*\{[^\n]+/)?.[0] || '';
  assert.doesNotMatch(rpl, /selisih|netsuite/);
  assert.match(rpl, /source_row_number/);
});

test('warning endpoint never downloads the large transaction ledgers', async () => {
  const originalFetch = globalThis.fetch, urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('/rpc/inventory_outbound_without_inbound')) return new Response(JSON.stringify([{ sku:'OUT-1', nama_barang:'Outbound' }]), { status:200 });
    return new Response('[]', { status:200 });
  };
  try {
    const result = await loadInventoryWarnings({ SUPABASE_URL:'https://example.supabase.co', SUPABASE_SECRET_KEY:'sb_secret_test' }, { page:1, limit:25 });
    assert.equal(result.rows.some(row => row.category === 'OUTBOUND_WITHOUT_INBOUND'), true);
    assert.equal(result.partial, false);
    assert.equal(urls.some(url => /rest\/v1\/inventory_barang_(masuk|keluar)/.test(url)), false);
  } finally { globalThis.fetch = originalFetch; }
});
