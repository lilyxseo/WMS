import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const columnsDeclaration = source.match(/const TRANSACTION_PRESENTATION_COLUMNS=[^;]+;/)?.[0];
const inboundColumnsDeclaration = source.match(/const BARANG_MASUK_PRESENTATION_COLUMNS=[^;]+;/)?.[0];
const outboundColumnsDeclaration = source.match(/const BARANG_KELUAR_PRESENTATION_COLUMNS=[^;]+;/)?.[0];
const helper = source.match(/function getTransactionPresentationCells\([^\n]+/)?.[0];
assert.ok(columnsDeclaration);
assert.ok(helper);
assert.ok(inboundColumnsDeclaration);
assert.ok(outboundColumnsDeclaration);
const context = {};
vm.runInNewContext(`${columnsDeclaration}${inboundColumnsDeclaration}${outboundColumnsDeclaration}${helper};result={inbound:BARANG_MASUK_PRESENTATION_COLUMNS,outbound:BARANG_KELUAR_PRESENTATION_COLUMNS,cells:(row,sheet)=>getTransactionPresentationCells(row,sheet)}`, context);

const inboundExpected = ['tanggal', 'from', 'to', 'sku', 'namaBarang', 'qty', 'status', 'pic', 'keterangan', 'no_iseller', 'netsuite', 'keterangan_lainnya', 'lokasi_surat_jalan', 'stockout', 'dokumen'];
const outboundExpected = ['tanggal', 'from', 'to', 'sku', 'namaBarang', 'qty', 'status', 'pic', 'keterangan', 'no_iseller', 'netsuite', 'keterangan_lainnya', 'status_lanjutan', 'lokasi_surat_jalan', 'no_iseller_awal', 'dokumen'];

test('Barang Masuk and Barang Keluar expose one fixed canonical column layout', () => {
  assert.deepEqual([...context.result.inbound], inboundExpected);
  assert.deepEqual([...context.result.outbound], outboundExpected);
  for (const [sheet, expected, row] of [
    ['Barang Masuk', inboundExpected, { tanggal: '2026-09-15', from: 'Receiving', from_location: 'debug-from', to: 'A01-1', to_location: 'debug-to', sku: 'IN-1', namaBarang: 'Produk', nama_barang: 'duplicate', qty: 1, status: 'OK', pic: 'Ani', keterangan: '-', rowNumber: 3, source_row_number: 3, synced_at: 'now' }],
    ['Barang Keluar', outboundExpected, { tanggal: '2026-09-15', from: 'A01-1', from_location: 'debug-from', to: 'Store', to_location: 'debug-to', sku: 'OUT-1', namaBarang: 'Produk', nama_barang: 'duplicate', qty: 1, status: 'OK', pic: 'Ani', keterangan: '-', rowNumber: 4, source_row_number: 4, synced_at: 'now' }],
  ]) {
    const cells = context.result.cells(row, sheet);
    assert.deepEqual(Object.keys(cells), expected);
    assert.equal(cells.from, row.from);
    assert.equal(cells.to, row.to);
    assert.equal(cells.namaBarang, row.namaBarang);
    for (const internal of ['from_location', 'to_location', 'nama_barang', 'rowNumber', 'source_row_number', 'synced_at']) assert.equal(internal in cells, false);
  }
});

test('loading, empty, rendered, and export states share the canonical columns', () => {
  assert.match(source, /const columns=st\.columns\?\.length\?st\.columns:\(mode==="in"\?BARANG_MASUK_PRESENTATION_COLUMNS:BARANG_KELUAR_PRESENTATION_COLUMNS\)/);
  assert.match(source, /function getMovementColumns\(rows=\[\],mode="out"\)/);
  assert.match(source, /const cols=st\.columns\|\|\[\];const lines=\[cols\.join\(","\)/);
  assert.match(source, /colspan='\$\{st\.columns\.length\+2\}'/);
});

test('DOKUMEN renders only HTTP(S) values as safe links', () => {
  assert.match(source, /url\.protocol==="https:"\|\|url\.protocol==="http:"/);
  assert.match(source, /target='_blank' rel='noopener noreferrer' aria-label='Lihat Dokumen'/);
  assert.match(source, /document-empty[^`]+Dokumen tidak tersedia[^`]+Tidak Ada/);
  assert.match(source, /if\(e\.target\.closest\("\.document-link-btn"\)\)return/);
});


test('STOCKOUT uses labelled status badges instead of raw booleans', () => {
  assert.match(source, /function renderStockoutValue\(value\)/);
  assert.match(source, /stockout-badge \${isStockout\?"is-yes":"is-no"}/);
  assert.match(source, /aria-label='\${label}' title='\${label}'/);
  assert.match(source, /renderPresentationValue\(c,r\?\._rawCells\?\.\[c\]\)/);
  const stockoutHelper = source.match(/function renderStockoutValue\([^\n]+/)?.[0];
  const stockoutContext = {};
  vm.runInNewContext(`${stockoutHelper};result=renderStockoutValue`, stockoutContext);
  assert.match(stockoutContext.result('TRUE'), /is-yes[^>]+aria-label='Stock Out'[^>]*><span aria-hidden='true'>✓/);
  assert.match(stockoutContext.result(false), /is-no[^>]+aria-label='Tidak Stock Out'[^>]*><span aria-hidden='true'>×/);
  assert.doesNotMatch(stockoutContext.result('TRUE'), />TRUE</);
  assert.match(stockoutContext.result(''), /stockout-empty[^>]+>—</);
});
