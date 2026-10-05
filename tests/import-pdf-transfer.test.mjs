import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeTransferNumber, resolveImportPdfSpreadsheetId, validateSheetName } from '../functions/api/import-pdf-transfer.js';

test('uses saved Import PDF config while global GOOGLE_SHEET_ID is empty', async () => {
  const result = await resolveImportPdfSpreadsheetId({
    GOOGLE_SHEET_ID: '',
    IMPORT_PDF_CONFIG: JSON.stringify({ spreadsheetId: 'configured-import-pdf' }),
  });
  assert.deepEqual(result, { spreadsheetId: 'configured-import-pdf', source: 'settings' });
});

test('never uses global GOOGLE_SHEET_ID as an Import PDF fallback', async () => {
  const result = await resolveImportPdfSpreadsheetId({ GOOGLE_SHEET_ID: 'global-sheet' });
  assert.equal(result.spreadsheetId, '');
  assert.equal(result.source, 'none');
});

test('uses application default before mapping and dedicated env fallback', async () => {
  const result = await resolveImportPdfSpreadsheetId({
    SHEET_ID_INVENTORY: 'application-sheet',
    SHEET_MAPPING: JSON.stringify({ importPdf: { spreadsheetId: 'mapped-sheet' } }),
    GOOGLE_SHEET_ID_IMPORT_PDF: 'fallback-sheet',
  });
  assert.deepEqual(result, { spreadsheetId: 'application-sheet', source: 'application-default' });
});

test('transfer number normalization preserves document identifier formatting', () => {
  assert.equal(normalizeTransferNumber('  #T-007894  '), '#T-007894');
  assert.equal(normalizeTransferNumber(' T-009001 '), 'T-009001');
});

test('Google Sheets name validation preserves valid hash and dash but rejects forbidden characters', () => {
  assert.deepEqual(validateSheetName('#T-007894'), { valid: true, name: '#T-007894' });
  assert.equal(validateSheetName('').message, 'Nomor Transfer belum tersedia.');
  assert.equal(validateSheetName('#T/007894').valid, false);
});

test('frontend derives destination from editable transfer number without destination dropdown', async () => {
  const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Sheet Tujuan|Pilih sheet tujuan|selectedSheetName/);
  assert.match(source, /transferNumber:transferCheck\.name/);
  assert.match(source, /if\(PDF_TRANSFER_STATE\.isImporting\)return/);
  assert.match(source, /Sheet akan dibuat sebagai:/);
  assert.match(source, /id='pdfTransferFile' type='file' accept='\.pdf,application\/pdf'/);
  assert.match(source, /TRANSFER_ALREADY_EXISTS/);
});

test('parser extracts the exact transfer identifier instead of its label', async () => {
  const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  assert.match(source, /match\(\/#\?T-\\d\+\/i\)/);
});

test('backend creates one new sheet, rejects duplicates, batches writes, and rolls back failures', async () => {
  const source = await readFile(new URL('../functions/api/import-pdf-transfer.js', import.meta.url), 'utf8');
  assert.match(source, /const BATCH_SIZE = 500/);
  assert.match(source, /addSheet:/);
  assert.match(source, /TRANSFER_ALREADY_EXISTS/);
  assert.match(source, /deleteSheet:/);
  assert.match(source, /body\.transferNumber/);
  assert.doesNotMatch(source, /body\.sheetName/);
});
