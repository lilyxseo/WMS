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

import vm from 'node:vm';
function singleResultHarness(rows,save=async()=>{}){
  const button={style:{}};let resets=0;
  const context=vm.createContext({document:{getElementById:()=>button,querySelector:()=>null},balikanSearchInput:null,BALIKAN_STATE:{shortcutCheckPending:false},PAGE_DATA_LOADS:new Map(),getPermissions:()=>({canUpdate:true}),getBalikanVisibleRows:()=>({rows}),isCheckedValue:value=>value==='TRUE',getBalikanActiveSheetName:row=>row.sheetName,window:{toggleBalikanCheck:save},resetBalikanSearch:()=>{resets++;},toast:()=>{},showToast:()=>{}});
  const start=source.indexOf('function syncBalikanSingleCheckShortcut('),end=source.indexOf('function handleBalikanSearchKeydown(',start);
  vm.runInContext(source.slice(start,end),context);
  return {context,button,resets:()=>resets};
}
test('single-result button excludes duplicate SKU rows and checked/read-only/loading results',()=>{
  const row={sku:'123',sheetName:'TRIP 1',rowNumber:2};const h=singleResultHarness([row]);
  h.context.syncBalikanSingleCheckShortcut([row]);assert.equal(h.button.hidden,false);assert.equal(h.button.disabled,false);
  h.context.syncBalikanSingleCheckShortcut([row,{...row,sheetName:'TRIP 2'}]);assert.equal(h.button.hidden,true);assert.equal(h.button.style.display,'none');
  h.context.syncBalikanSingleCheckShortcut([{...row,checked:'TRUE'}]);assert.equal(h.button.disabled,true);
  h.context.getPermissions=()=>({canUpdate:false});h.context.syncBalikanSingleCheckShortcut([row]);assert.equal(h.button.hidden,true);
  h.context.getPermissions=()=>({canUpdate:true});h.context.PAGE_DATA_LOADS.set('balikan-store',{loading:true});h.context.syncBalikanSingleCheckShortcut([row]);assert.equal(h.button.disabled,true);
});
test('quick check serializes clicks, writes exact sheet/row and preserves search on failed save',async()=>{
  let reject,calls=0;const h=singleResultHarness([{sku:'123',sheetName:'TRIP 2',rowNumber:8}],(sheet,row,checked)=>{calls++;assert.equal(sheet,'TRIP 2');assert.equal(row,8);assert.equal(checked,true);return new Promise((_,r)=>{reject=r;});});
  const pending=h.context.autoCheckSingleBalikanResult();await h.context.autoCheckSingleBalikanResult();assert.equal(calls,1);assert.equal(h.button.disabled,true);
  reject(new Error('offline'));await pending;assert.equal(h.resets(),0);assert.equal(h.button.disabled,false);
  h.context.window.toggleBalikanCheck=async()=>{};await h.context.autoCheckSingleBalikanResult();assert.equal(h.resets(),1);
});

test('Alt digits choose displayed location and reject edits, repeats, stale results and disabled choices',()=>{
  const search={typing:true},editor={typing:true},row={rowNumber:7},buttons=[{dataset:{sheetName:'TRIP 1',rowNumber:'7',location:'A01-1'}},{dataset:{sheetName:'TRIP 1',rowNumber:'7',location:'B02-2'}}];let selected=null;
  const context=vm.createContext({document:{querySelector:()=>search,querySelectorAll:()=>buttons},balikanSearchInput:search,isKeyboardTypingTarget:t=>!!t?.typing,getPermissions:()=>({canUpdate:true}),PAGE_DATA_LOADS:new Map(),BALIKAN_STATE:{},getBalikanVisibleRows:()=>({rows:[row]}),getBalikanLocationCardRow:rows=>rows[0],getBalikanActiveSheetName:()=>'TRIP 1',getBalikanSkuLocationOptions:()=>[{rawLocation:'A01-1'},{rawLocation:'B02-2'}],normalizeBalikanLocation:v=>v||'',handleBalikanLocationSelect:button=>{selected=button;},Element:class{}});
  const start=source.indexOf('function handleBalikanShortcutKeydown('),end=source.indexOf('let balikanShortcutsActive',start);vm.runInContext(source.slice(start,end),context);
  const event={altKey:true,key:'2',code:'Digit2',target:search,preventDefault(){this.prevented=true;}};
  context.handleBalikanShortcutKeydown(event);assert.equal(selected,buttons[1]);assert.equal(event.prevented,true);
  for(const overrides of [{target:editor},{repeat:true},{isComposing:true},{key:'9',code:'Digit9'}]){selected=null;context.handleBalikanShortcutKeydown({...event,...overrides});assert.equal(selected,null);}
  buttons[1].disabled=true;selected=null;context.handleBalikanShortcutKeydown(event);assert.equal(selected,null);
  buttons[1].disabled=false;context.getBalikanVisibleRows=()=>({rows:[{rowNumber:8}]});context.handleBalikanShortcutKeydown(event);assert.equal(selected,null);
});
