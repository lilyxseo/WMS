import test from 'node:test';
import assert from 'node:assert/strict';
import {readGtOrders,handleGtOrders} from '../functions/api/orderan-gt.js';
import {filterGtOrders,gtOrderStatusCounts} from '../assets/js/orderan-gt.js';

const row = (...values) => ({values:values.map(value=>typeof value==='number'?{formattedValue:String(value),effectiveValue:{numberValue:value}}:{formattedValue:value})});
const sheet = {
  properties:{sheetId:784945780,title:'LIST GT ORDER'},
  merges:[{startRowIndex:1,endRowIndex:3,startColumnIndex:6,endColumnIndex:7}],
  data:[{rowData:[
    row('SKU','Nama Produk','Qty\nRequest','Qty Picking','Status','Payment','Customer','BULKY','RETAIL','KET','status picking','Remark'),
    row('0012','Produk A',6,2,'Packing','TOP','Customer A',0,3,'REQ ECOM','MASIH KURANG'),
    row('GT-02','Produk B',5,5,'Siap Kirim','DONE',''),
    row('GT-03','Produk C',1,1,'Terkirim','DONE','Customer A'),
    row('','Produk D',9,'','Permintaan Baru','BELUM',''),
    row('','','','','','','')
  ]}]
};

test('GT parser groups only actual Customer merges, keeps source SKU and flags incomplete items',()=>{
  const orders=readGtOrders(sheet);
  assert.deepEqual(orders.map(order=>[order.row,order.customer,order.active,order.missingSku]),[[5,'',true,1],[4,'Customer A',false,0],[2,'Customer A',true,0]]);
  assert.deepEqual(orders[2].items.map(item=>item.sku),['0012','GT-02']);
  assert.equal(orders[2].items[0].bulky,0);
  assert.equal(orders[2].items[0].pickingStatus,'MASIH KURANG');
  assert.equal(orders[0].items[0].picked,null);
  assert.deepEqual(filterGtOrders(orders,'active','customer a gt-02').map(order=>order.row),[2]);
});

test('GT endpoint requires a session and reads the configured sheet/tab only',async()=>{
  const context={request:new Request('https://wms.example/api/orderan-gt'),env:{SHEET_ID_2026:'A'.repeat(35)}};
  const getToken=async()=>{throw Error('Unexpected token call');};
  assert.equal((await handleGtOrders(context,{authorize:async()=>false,getToken})).status,401);
  const response=await handleGtOrders(context,{authorize:async()=>true,getToken:async()=>'mock',fetchFn:async input=>{
    const url=new URL(input);
    assert.equal(url.hostname,'sheets.googleapis.com');
    assert.equal(url.pathname,`/v4/spreadsheets/${context.env.SHEET_ID_2026}`);
    assert.equal(url.searchParams.get('ranges'),"'LIST GT ORDER'!A:L");
    return Response.json({sheets:[sheet]});
  }});
  assert.equal(response.status,200);
  assert.equal((await response.json()).orders[2].items[0].sku,'0012');
  const wrong=await handleGtOrders(context,{authorize:async()=>true,getToken:async()=>'mock',fetchFn:async()=>Response.json({sheets:[{...sheet,properties:{...sheet.properties,sheetId:1}}]})});
  assert.equal(wrong.status,503);
});

test('CLOSE and Closed items do not keep orders active, and both filters must match the same item',()=>{
  const source={data:[{rowData:[
    ...sheet.data[0].rowData.slice(0,3),
    row('GT-C','Produk Close',1,1,' CLOSE ','DONE','Customer C'),
    row('GT-D','Produk Closed',1,1,'Closed','DONE','Customer D')
  ]}],merges:sheet.merges};
  const orders=readGtOrders(source);
  assert.deepEqual(filterGtOrders(orders,'active','').map(order=>order.customer),['Customer A']);
  assert.equal(filterGtOrders(orders,'all','',{status:'CLOSE'}).length,1);
  assert.equal(filterGtOrders(orders,'active','',{status:'Packing',pickingStatus:'MASIH KURANG'}).length,1);
  assert.equal(filterGtOrders(orders,'active','',{status:'Siap Kirim',pickingStatus:'MASIH KURANG'}).length,0);
});

test('status cards count distinct orders for each status, including CLOSE',()=>{
  const orders=[
    {items:[{status:'Packing'},{status:'Packing'},{status:'Proses'}]},
    {items:[{status:'Packing'}]},
    {items:[{status:'CLOSE'},{status:''}]}
  ];
  assert.deepEqual(gtOrderStatusCounts(orders),[['CLOSE',1],['Packing',2],['Proses',1]]);
});

test('Stok Kosong and Close do not count as active, but a mixed order can still have an active item',()=>{
  const source={data:[{rowData:[
    sheet.data[0].rowData[0],
    row('GT-01','Produk A',2,0,' Stok Kosong ','','Customer A'),
    row('GT-02','Produk B',1,0,'CLOSE','',''),
    row('GT-03','Produk C',3,0,'STOK KOSONG','','Customer B'),
    row('GT-04','Produk D',2,1,'Packing','','')
  ]}],merges:[
    {startRowIndex:1,endRowIndex:3,startColumnIndex:6,endColumnIndex:7},
    {startRowIndex:3,endRowIndex:5,startColumnIndex:6,endColumnIndex:7}
  ]};
  const orders=readGtOrders(source);
  assert.deepEqual(filterGtOrders(orders,'active','').map(order=>order.customer),['Customer B']);
  assert.equal(filterGtOrders(orders,'all','',{status:'Stok Kosong'})[0].customer,'Customer A');
  assert.equal(filterGtOrders(orders,'all','',{status:'CLOSE'})[0].customer,'Customer A');
});
