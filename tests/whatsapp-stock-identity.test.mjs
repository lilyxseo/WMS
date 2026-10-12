import test from 'node:test';
import assert from 'node:assert/strict';
import { stockIdentity } from '../supabase/functions/whatsapp-fonnte/stock-identity.js';
const state = { direction: 'out', location: 'A1', row: { nama_barang: 'Merlyn Green Gold', lokasi_bulky: 'A1' } };
const indices = [0, 1, 2, 3];
test('identity ignores whitespace/case and names at unrelated locations', () => {
 assert.equal(stockIdentity([['A1', '00123', 'MERLYN  GREEN\nGOLD', 12], ['B1', '00123', 'Old name', 0], ['B2', '00123', '', 0]], indices, state).matches, true);
});
test('identity requires a unique nonempty new name for re-confirmation', () => {
 assert.deepEqual(stockIdentity([['A1', '00123', 'New name', 12]], indices, state), { matches: false, name: 'New name' });
 assert.deepEqual(stockIdentity([['A1', '00123', '', 12]], indices, state), { matches: false });
 assert.deepEqual(stockIdentity([['A1', '00123', 'Other', 12], ['A1', '00123', 'Conflicting', 12]], indices, state), { matches: false });
});
