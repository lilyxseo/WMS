import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/pages.css', import.meta.url), 'utf8');

const shortcutsStart = source.indexOf('function isKeyboardTypingTarget');
const shortcutsEnd = source.indexOf('\nfunction resetBalikanSearch()', shortcutsStart);
const shortcuts = source.slice(shortcutsStart, shortcutsEnd);

test('Balikan keyboard handlers are installed only while its route is active', () => {
  assert.match(source, /function showPage\(page\)\{syncBalikanShortcutListeners\(page==="balikan-store"\)/);
  assert.match(shortcuts, /addEventListener\('keydown',handleBalikanShortcutKeydown\)/);
  assert.match(shortcuts, /removeEventListener\('keydown',handleBalikanShortcutKeydown\)/);
  assert.match(source, /function showLoginView\(\)\{\nsyncBalikanShortcutListeners\(false\)/);
});

test('focus shortcuts select search without firing slash while typing', () => {
  assert.match(shortcuts, /ctrlKey.*key\)\.toLowerCase\(\)==='k'.*preventDefault\(\).*focusBalikanSearch/s);
  assert.match(shortcuts, /isKeyboardTypingTarget\(event\.target\).*return/);
  assert.match(shortcuts, /event\.key==='\/'.*preventDefault\(\).*focusBalikanSearch/s);
  assert.match(shortcuts, /input, textarea, select, \[contenteditable/);
});

test('Enter checks only one selectable result and protects duplicates', () => {
  assert.match(shortcuts, /rows\.length!==1\|\|getPermissions\(\)\.canUpdate===false/);
  assert.match(shortcuts, /isCheckedValue\(row\.checked\).*Sudah dipilih/s);
  assert.match(shortcuts, /toggleBalikanCheck\([^;]+true\)/);
  assert.match(shortcuts, /resetBalikanSearch\(\);\n\s*focusBalikanSearch\(\)/);
});

test('Escape reuses search-only reset and Space toggles a focused row', () => {
  assert.match(shortcuts, /event\.key==='Escape'.*resetBalikanSearch\(\)/s);
  assert.match(shortcuts, /closest\('#balikanTable tr\[data-row-number\]'\)/);
  assert.match(shortcuts, /event\.preventDefault\(\);\n\s*checkbox\.checked=!checkbox\.checked/);
  assert.match(source, /tr\.tabIndex=0/);
  assert.match(source, /checkbox\.setAttribute\('aria-label'/);
});

test('search exposes concise shortcut help and keyboard focus styling', () => {
  assert.match(html, /id="balikanShortcutHint"[^>]*><kbd>\/</);
  assert.match(html, /aria-describedby="balikanShortcutHint"/);
  assert.match(css, /balikan-table tbody tr:focus/);
});
