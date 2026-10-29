import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {transactionRowMatchesSearch} from '../functions/api/_transaction-read.js';
const source=readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
const line=name=>source.slice(source.indexOf('function '+name+'('),source.indexOf('\n',source.indexOf('function '+name+'(')));
const rows=[{sku:'000123',nama:'GOTO MERLYN GALLON PUMP ECO BLACK',lokasi:'A01-1',stok_akhir:4},{sku:'000124',nama:'GOTO MERLYN GALLON PUMP ECO WHITE',lokasi:'B01-1',stok_akhir:2},{sku:'000125',nama:'GOTO MERLYN BLACK',lokasi:'C01-1',stok_akhir:3}];
for(const query of ['merlyn eco black','BLACK merlyn ECO',' merlyn   eco\tblack '])test('non-adjacent words work across both ledgers, Movement and Cycle Count: '+JSON.stringify(query),()=>{
 const state={value:query},ctx=vm.createContext({clean:value=>String(value).toLowerCase().trim(),getCycleSourceRows:()=>rows,DATA:{'Kartu Stock':rows},INVENTORY_VERSION_STATE:{versions:{}},inSearch:state,outSearch:state,FILTERABLE_COLUMNS:['namaBarang'],ensureColumnFilterState:()=>({}),sanitizeFilterValue:value=>value});
 vm.runInContext(source.slice(source.indexOf('let movementSearchIndex='),source.indexOf('function parseLokasiSignature('))+'\n'+line('getCycleCandidates')+'\n'+line('applyTableFilters'),ctx);
 assert.equal(ctx.getMovementCandidates(query)[0].sku,'000123');assert.equal(ctx.getMovementCandidates(query).length,1);assert.equal(ctx.getCycleCandidates(query).length,1);
 const ledger=rows.map(row=>({...row,_searchText:(row.sku+' '+row.nama).toLowerCase(),nama_barang:row.nama}));for(const mode of ['in','out']){assert.equal(ctx.applyTableFilters(ledger,mode).length,1);assert.equal(ctx.applyTableFilters(ledger,mode)[0].sku,'000123');}assert.equal(ledger.filter(row=>transactionRowMatchesSearch(row,query,['sku','nama_barang'])).length,1);
});
