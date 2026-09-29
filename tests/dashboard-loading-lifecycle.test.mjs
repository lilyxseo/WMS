import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');

function between(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

test('dashboard route is the single owner of dashboard requests', () => {
  const prefetch = between('async function startInitialPrefetch()', 'async function startBackgroundPreload()');
  assert.doesNotMatch(prefetch, /loadDashboardSummary|loadDashboardPayload/);
  const route = between('function showPage(page)', 'function pageTitleFromPath');
  assert.match(route, /page==='dashboard'.*loadDashboardPayload/);
});

test('dashboard sections deduplicate requests and always settle loading state', () => {
  const loaders = between('function beginDashboardSection', 'function renderInventorySyncStatus');
  for (const section of ['summary', 'recent', 'insight']) {
    assert.match(loaders, new RegExp(`DASHBOARD_REQUESTS\\.${section}`));
    assert.match(loaders, new RegExp(`finishDashboardSection\\('${section}'`));
  }
  assert.match(loaders, /Promise\.allSettled/);
});

test('dashboard renderer distinguishes loading, error, success, and retry', () => {
  const renderer = between('function dashboardSectionState', 'function renderInsightCard');
  assert.match(renderer, /DASHBOARD_LOAD_STATE\[section\]==='loading'/);
  assert.match(renderer, /DASHBOARD_LOAD_STATE\[section\]==='error'/);
  assert.match(renderer, /data-retry-dashboard-\$\{section\}/);
  assert.match(renderer, /DASHBOARD_LOAD_STATE\.recent==='success'/);
});
