import test from 'node:test';
import assert from 'node:assert/strict';
import {netsuiteStockContent,mountSkuNetsuiteStock} from '../assets/js/sku-netsuite-stock.js';
test('NetSuite card preserves verified zero and negative stock without substituting unknown balances',()=>{
 for(const qty of [0,-2,1500])assert.equal(netsuiteStockContent({ready:true,rows:[{sku:'0012',stok_netsuite:qty}]},'0012').value,qty.toLocaleString('id-ID'));
 for(const value of [null,undefined,'','bad'])assert.equal(netsuiteStockContent({ready:true,rows:[{sku:'0012',stok_netsuite:value}]},'0012').value,'—');
 assert.equal(netsuiteStockContent({ready:false,rows:[{sku:'0012',stok_netsuite:5}]},'0012').value,'—');assert.equal(netsuiteStockContent({ready:true,rows:[{sku:'0013',stok_netsuite:5}]},'0012').value,'—');
});
test('detached or obsolete SKU requests cannot update the current card',async()=>{
 let resolve;const root={isConnected:true,innerHTML:'',setAttribute(){}};const controller=mountSkuNetsuiteStock(root,{sku:'0012',fetchFn:()=>new Promise(r=>resolve=r)});controller.dispose();root.innerHTML='New SKU';resolve({ok:true,json:async()=>({success:true,ready:true,rows:[{sku:'0012',stok_netsuite:123}]})});await new Promise(setImmediate);assert.equal(root.innerHTML,'New SKU');
});
