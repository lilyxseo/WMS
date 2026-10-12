import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKartuStockHeader } from '../supabase/functions/whatsapp-fonnte/kartu-stok-header.js';

test('stock header detects titles, punctuation and explicit closing stock instead of opening stock or qty', () => {
 const result = parseKartuStockHeader([['Inventory'], [], ['Lokasi_Bulky', 'SKU', 'Nama-Barang', 'STOK AWAL', 'Qty', 'Stok Akhir']]);
 assert.deepEqual(result, { headerIndex: 2, indices: [0, 1, 2, 5], missing: [] });
});
test('stock header supports English aliases and columns beyond Z', () => {
 const header = Array(30).fill('');
 header.splice(26, 4, 'Location', 'Item code', 'Product name', 'Ending stock');
 assert.deepEqual(parseKartuStockHeader([header]).indices, [26, 27, 28, 29]);
});
test('stock header refuses missing closing stock and duplicate canonical stock columns', () => {
 assert.deepEqual(parseKartuStockHeader([['Lokasi', 'SKU', 'Nama', 'Stok Awal']]).missing, ['qty']);
 assert.deepEqual(parseKartuStockHeader([['Lokasi', 'SKU', 'Nama', 'Stok Akhir', 'Stok Akhir', 'Qty']]).missing, ['qty']);
});
