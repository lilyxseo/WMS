import test from 'node:test';
import assert from 'node:assert/strict';
import { agingBucket, computeStockAging } from '../functions/api/inventory-aging.js';

test('aging buckets use clear 30, 60, and 90 day boundaries', () => {
  assert.equal(agingBucket(30), 'active');
  assert.equal(agingBucket(31), 'slow');
  assert.equal(agingBucket(60), 'slow');
  assert.equal(agingBucket(61), 'aging');
  assert.equal(agingBucket(90), 'aging');
  assert.equal(agingBucket(91), 'dead');
  assert.equal(agingBucket(0, true), 'dead');
});

test('stock aging aggregates positive stock and uses latest valid outbound', () => {
  const result = computeStockAging({
    kartuStok: [
      { sku: 'A', nama_barang: 'Alpha', stok_akhir: 4, lokasi_bulky: 'L-1' },
      { sku: 'a', nama_barang: 'Alpha', stok_akhir: 6, lokasi_bulky: 'L-2' },
      { sku: 'B', nama_barang: 'Beta', stok_akhir: 3, lokasi_bulky: 'L-3' },
      { sku: 'C', nama_barang: 'Zero', stok_akhir: 0 },
    ],
    barangKeluar: [
      { sku: 'A', tanggal: '2026-08-01', keterangan: 'PENGELUARAN' },
      { sku: 'A', tanggal: '2026-09-15', keterangan: 'Pengeluaran' },
      { sku: 'A', tanggal: '2026-10-01', keterangan: 'LAINNYA' },
    ],
  }, new Date('2026-10-05T12:00:00Z'));
  const alpha = result.rows.find(row => row.sku === 'A');
  const beta = result.rows.find(row => row.sku === 'B');
  assert.deepEqual(alpha, { sku: 'A', namaBarang: 'Alpha', stock: 10, locations: ['L-1', 'L-2'], lastMovement: '2026-09-15', daysSinceMovement: 20, neverMoved: false, bucket: 'active' });
  assert.equal(beta.bucket, 'dead');
  assert.equal(beta.neverMoved, true);
  assert.deepEqual(result.summary, { totalSku: 2, totalUnits: 13, active: 1, slow: 0, aging: 0, dead: 1, deadUnits: 3, neverMoved: 1 });
});
