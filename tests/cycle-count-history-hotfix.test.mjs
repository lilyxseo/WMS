import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapCycleCountHistory } from '../functions/api/cycle-count.js';

test('cycle count history is chronological and deterministically ordered', () => {
  const rows = mapCycleCountHistory([
    ['14/09/2026', 'A', 'OLD', 'Old', 2, 1, ''],
    ['15/09/2026', 'B', 'FIRST', 'First', 3, 3, ''],
    ['15/09/2026', 'C', 'SECOND', 'Second', 4, 5, 'note'],
  ]);
  assert.deepEqual(rows.map(row => row.sku), ['SECOND', 'FIRST', 'OLD']);
  assert.deepEqual(rows.map(row => row.rowNumber), [6, 5, 4]);
});

test('cycle count route owns an authenticated paginated history request and distinct states', () => {
  const source = fs.readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
  assert.match(source, /getAuthHeaders\(\)/);
  assert.match(source, /\/api\/cycle-count\?page=\$\{cycleHistoryPage\}&limit=\$\{cycleHistoryPageSize\}/);
  assert.match(source, /Memuat history cycle count/);
  assert.match(source, /Gagal memuat history cycle count/);
  assert.match(source, /data-cc-history-retry/);
  assert.match(source, /Belum ada history cycle count/);
  const loader = source.slice(source.indexOf('async function loadCycleCountHistory'), source.indexOf('function getQty(item)'));
  assert.doesNotMatch(loader, /mode=full|preloadData|hydrateAllDataOnInit|indexedDB/i);
  assert.doesNotMatch(source, /DOMContentLoaded[^\n]+ensureCycleHistoryLoaded/);
});

test('cycle count controls use a responsive shared grid and equal height', () => {
  const css = fs.readFileSync(new URL('../assets/css/pages.css', import.meta.url), 'utf8');
  assert.match(css, /\.cc-filter-row\{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:minmax\(220px,1fr\) minmax\(320px,1fr\);[\s\S]*?align-items:end;/);
  assert.match(css, /\.cc-filter-row \.search-lg\{[^}]*height:48px/);
  assert.match(css, /@media \(max-width:768px\)[\s\S]*?\.cc-filter-row\{grid-template-columns:minmax\(0,1fr\)\}/);
});
