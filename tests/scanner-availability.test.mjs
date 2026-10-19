import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('scanner library loads on demand with a pinned version and fallback CDN', () => {
  assert.doesNotMatch(htmlSource, /<script[^>]+src="[^"]*html5-qrcode/);
  assert.match(mainSource, /const SCANNER_LIBRARY_URLS=\[/);
  assert.match(mainSource, /cdn\.jsdelivr\.net\/npm\/html5-qrcode@2\.3\.8/);
  assert.match(mainSource, /unpkg\.com\/html5-qrcode@2\.3\.8/);
  assert.match(mainSource, /SCANNER_STATE\.libraryPromise=null/);
});

test('every scanner caller can open the shared modal regardless of route formatting', () => {
  const modal = mainSource.slice(mainSource.indexOf('async function openScannerModal'), mainSource.indexOf('async function closeScannerModal'));
  assert.match(modal, /await ensureScannerLibrary\(\)/);
  assert.match(modal, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.doesNotMatch(modal, /location\.pathname|\/search|\/balikan-store|\/movement|\/barang-reject/);
});

test('scanner format configuration tolerates partially available browser builds', () => {
  const config = mainSource.slice(mainSource.indexOf('function getScannerConfig'), mainSource.indexOf('function playScanSuccessFeedback'));
  assert.match(config, /if\(supported\)config\.formatsToSupport=/);
  assert.match(config, /filter\(Number\.isInteger\)/);
});
