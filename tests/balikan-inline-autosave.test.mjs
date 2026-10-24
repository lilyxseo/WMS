import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const grid=fs.readFileSync(new URL('../assets/js/editable-table-grid.js',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../assets/js/main.js',import.meta.url),'utf8');
function harness(){const jobs=new Map(),saved=[];let id=0;const autoSave=vm.runInNewContext(main.match(/autoSave:(scope=>scope==='balikan')/)[1]);const context=vm.createContext({autoSave,editor:null,clearTimeout:key=>jobs.delete(key),setTimeout:callback=>{jobs.set(++id,callback);return id;},commit:state=>saved.push([...state.pending.values()])});vm.runInContext(grid.match(/ function queueAutoSave\(state\)\{[^\n]+/)[0],context);return {context,jobs,saved,queue:state=>context.queueAutoSave(state),flush(){const work=[...jobs.values()];jobs.clear();work.forEach(run=>run());}};}
const state=()=>({scope:'balikan',pending:new Map([['location','A10-1']]),busy:false});
test('Balikan inline edits coalesce into an automatic save of the latest cell values',()=>{const h=harness(),s=state();h.queue(s);s.pending.set('location','B20-2');h.queue(s);assert.equal(h.jobs.size,1);h.flush();assert.deepEqual(h.saved,[['B20-2']]);assert.equal(s.autoSaveTimer,null);});
test('Balikan autosave waits for an open editor to finish, including an unchanged second cell',()=>{const h=harness(),s=state();h.context.editor={state:s};h.queue(s);h.flush();assert.equal(h.saved.length,0);h.context.editor=null;h.queue(s);h.flush();assert.equal(h.saved.length,1);});
test('Other tables retain explicit saving and empty or busy Balikan drafts do not submit',()=>{const h=harness();h.queue({...state(),scope:'transaction-masuk'});assert.equal(h.jobs.size,0);h.queue({...state(),busy:true});h.flush();h.queue({...state(),pending:new Map()});h.flush();assert.equal(h.saved.length,0);});
