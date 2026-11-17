import test from 'node:test';
import assert from 'node:assert/strict';
import {assetEditorFields} from '../assets/js/asset-editor.js';
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
