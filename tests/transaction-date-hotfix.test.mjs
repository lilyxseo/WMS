import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTransactionDate, orderTransactionRows, transactionPage } from '../functions/api/_transaction-read.js';

test('transaction parser treats slash dates as MM/DD/YYYY and rejects malformed dates', () => {
  for (const [raw, expected] of [
    ['2026-09-15', '2026-09-15'], ['9/15/2026', '2026-09-15'],
    ['09/15/2026', '2026-09-15'], ['12/31/2025', '2025-12-31'],
  ]) assert.deepEqual(normalizeTransactionDate(raw), { valid: true, value: expected });
  for (const raw of ['', '31/12/2025', '2/30/2026', 'not-a-date']) {
    assert.deepEqual(normalizeTransactionDate(raw), { valid: false, value: null });
  }
});

test('mixed formats sort chronologically with invalid dates last and a stable row tie breaker', () => {
  const dates = ['2025-12-31', '1/1/2026', '2/5/2026', '9/15/2026', '10/1/2026', '2026-09-14'];
  const rows = dates.map((tanggal, index) => ({ tanggal, source_row_number: index + 2 }));
  rows.push({ tanggal: 'bad', source_row_number: 99 });
  assert.deepEqual(orderTransactionRows(rows).map(item => item.parsedDate.value), [
    '2026-10-01', '2026-09-15', '2026-09-14', '2026-02-05', '2026-01-01', '2025-12-31', null,
  ]);
});

test('date range, metrics, latest page, and pagination use normalized chronology', async () => {
  const originalFetch = globalThis.fetch;
  const rows = [
    { tanggal: '2025-12-31', sku: 'A', qty: 1, source_row_number: 2 },
    { tanggal: '9/15/2026', sku: 'B', qty: 2, source_row_number: 3 },
    { tanggal: '2026-09-14', sku: 'C', qty: 3, source_row_number: 4 },
    { tanggal: 'bad', sku: 'D', qty: 4, source_row_number: 5 },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-range': '0-3/4' } });
  try {
    const result = await transactionPage({ url: 'https://db.example', key: 'secret' }, 'inventory_barang_masuk', {
      startDate: '2026-09-01', endDate: '2026-09-15', limit: 1,
    });
    assert.deepEqual(result.rows.map(row => row.tanggal), ['9/15/2026']);
    assert.equal(result.total, 2);
    assert.deepEqual(result.summary, { totalRows: 2, totalQty: 5, totalSku: 2, latestDate: '2026-09-15', oldestDate: '2026-09-14', invalidDateCount: 1 });
    const all = await transactionPage({ url: 'https://db.example', key: 'secret' }, 'inventory_barang_masuk', { limit: 50 });
    assert.deepEqual(all.rows.map(row => row.tanggal), ['9/15/2026', '2026-09-14', '2025-12-31', 'bad']);
    assert.equal(all.summary.invalidDateCount, 1);
    assert.equal(all.summary.latestDate, '2026-09-15');
    assert.equal(all.summary.oldestDate, '2025-12-31');
  } finally { globalThis.fetch = originalFetch; }
});
