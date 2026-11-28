import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInventoryHistory} from '../functions/api/inventory-history.js';

const context=query=>({
  request:new Request(`https://example.test/api/inventory-history${query}`),
  env:{SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'sb_secret_test'}
});

test('inventory history requires authentication and validates dates and dataset',async()=>{
  const unexpected=async()=>assert.fail('Invalid requests must not read inventory');
  assert.equal((await handleInventoryHistory(context(''),{authorize:async()=>false,fetchFn:unexpected})).status,401);
  for(const query of ['?date=9999-01-01','?date=2026-02-29','?date=0000-01-01','?kind=current','?date=2026-2-1']){
    const response=await handleInventoryHistory(context(query),{authorize:async()=>true,fetchFn:unexpected});
    assert.equal(response.status,400);
  }
});

test('inventory history forwards the requested date to the ledger query and keeps unavailable stock explicit',async()=>{
  const day='2026-11-25';
  const response=await handleInventoryHistory(context(`?date=${day}&kind=outbound&q=0012&page=3`),{
    authorize:async()=>true,
    fetchFn:async(url,init)=>{
      assert.equal(new URL(url).pathname,'/rest/v1/rpc/read_inventory_daily_history');
      assert.deepEqual(JSON.parse(init.body),{p_date:day,p_kind:'outbound',p_page:3,p_query:'0012'});
      return Response.json({date:day,stockAvailable:false,latestDate:'2026-11-28',page:1,total:0,rows:[]});
    }
  });
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  const body=await response.json();
  assert.equal(body.date,day);
  assert.equal(body.stockAvailable,false);
  assert.deepEqual(body.rows,[]);
});
