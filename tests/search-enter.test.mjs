import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
function fixture(query,results){const opened=[],ctx=vm.createContext({SEARCH_STATE:{minChars:2,runToken:0,completedQuery:query,completedSource:'Semua'},authRequestGeneration:1,searchInput:{value:query},currentFilter:'Semua',lastResults:results,selectedQuickSku:'',getActivePage:()=> 'search',normalizeSearch:x=>String(x).toLowerCase(),clean:x=>String(x).toLowerCase(),clearTimeout(){},navigateToSku:sku=>opened.push(sku),runSearch:async()=>{}});vm.runInContext(source.slice(source.indexOf('async function openSearchResultOnEnter(){'),source.indexOf('async function runSearch(){')),ctx);return {ctx,opened};}
test('Enter opens exact SKU first or the only result, preserving leading zeros',async()=>{
 for(const [query,rows,expected] of [['0012',[{sku:'A'},{sku:'0012'}],'0012'],['backpack',[{sku:'GT-BP-PK'}],'GT-BP-PK']]){const f=fixture(query,rows);await f.ctx.openSearchResultOnEnter();assert.deepEqual(f.opened,[expected]);}
});
test('Enter immediately completes pending search and does not open stale results after typing or navigation',async()=>{
 for(const change of [ctx=>ctx.searchInput.value='another',ctx=>ctx.authRequestGeneration++,ctx=>ctx.getActivePage=()=> 'dashboard']){const f=fixture('old',[{sku:'OLD'}]);f.ctx.searchInput.value='new';let complete;f.ctx.runSearch=()=>new Promise(r=>complete=()=>{f.ctx.SEARCH_STATE.completedQuery='new';f.ctx.lastResults=[{sku:'NEW'}];r();});const pending=f.ctx.openSearchResultOnEnter();change(f.ctx);complete();await pending;assert.deepEqual(f.opened,[]);}
});
test('Enter does not guess a SKU when results are ambiguous or empty',async()=>{for(const rows of [[],[{sku:'A'},{sku:'B'}]]){const f=fixture('product',rows);await f.ctx.openSearchResultOnEnter();assert.deepEqual(f.opened,[]);}});
