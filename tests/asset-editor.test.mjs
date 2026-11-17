import test from 'node:test';
import assert from 'node:assert/strict';
import {assetEditorFields,assetToday} from '../assets/js/asset-editor.js';
test('new assets default to today in the user timezone with optional fields and sheet Section choices',()=>{
 const now=new Date('2026-11-17T18:00:00Z');
 assert.equal(assetToday(now),'2026-11-18');
 const html=assetEditorFields(['Date','Section','QTY'],{}, {create:true,now,sectionOptions:['Gudang','Store','Store']});
 assert.match(html,/type="date"[^>]*value="2026-11-18"/);
 assert.match(html,/<select[^>]*name="field1"/);
 assert.match(html,/<option value="">Pilih section \(opsional\)<\/option>/);
 assert.equal((html.match(/value="Store"/g)||[]).length,1);
 assert.doesNotMatch(html,/\brequired\b/);
 const edit=assetEditorFields(['Date','Section'],{Date:'11/1/2026',Section:'Legacy'},{sectionOptions:['Store']});
 assert.match(edit,/value="11\/1\/2026"/);assert.match(edit,/value="Legacy" selected/);
});
test('Asset fields preserve sheet order, identifiers and existing values while using suitable controls',()=>{
 const html=assetEditorFields(['SKU','Qty','Keterangan','Nilai'],{SKU:'0012',Qty:'4',Keterangan:'One\nTwo',Nilai:'1,000'});
 assert.match(html,/name="field0"[^>]*type="text"[^>]*value="0012"/);
 assert.match(html,/name="field1"[^>]*type="number"[^>]*step="any"/);
 assert.match(html,/<textarea[^>]*name="field2"[^>]*>One\nTwo<\/textarea>/);
 assert.match(html,/name="field3"[^>]*type="text"[^>]*value="1,000"/);
 assert.equal((html.match(/<label /g)||[]).length,4);
});
test('Asset field names and values cannot inject markup',()=>{
 const html=assetEditorFields(['<script>','Catatan'],{'<script>':'" autofocus onfocus="alert(1)',Catatan:'</textarea><script>alert(1)</script>'});
 assert.doesNotMatch(html,/<script>|value="" autofocus/);
 assert.match(html,/value="&quot; autofocus onfocus=&quot;alert/);
 assert.match(html,/&lt;\/textarea&gt;/);
});
