// Read-only statistics and small operational samples. No user profiles, tokens,
// document URLs, or full transaction ledgers are exported.
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('Audit configuration unavailable');
if(process.argv.includes('--movement')){
 const query=`select jsonb_build_object(
 'stock',(select jsonb_agg(j) from (select 'Kartu Stok' as source,sku,lokasi_bulky,stok_awal,internal_stock_transfer,replenishment,pengeluaran,stok_akhir,source_row_number from public.inventory_kartu_stok where sku='682200007014' union all select 'BULKY',sku,lokasi_bulky,stok_awal,internal_stock_transfer,replenishment,pengeluaran,stok_akhir,source_row_number from public.inventory_bulky where sku='682200007014') j),
 'inbound',(select jsonb_agg(j) from (select tanggal,from_location,to_location,sku,qty,status,keterangan,source_row_number,synced_at from public.inventory_barang_masuk where sku='682200007014' order by tanggal,source_row_number) j),
 'outbound',(select jsonb_agg(j) from (select tanggal,from_location,to_location,sku,qty,status,keterangan,source_row_number from public.inventory_barang_keluar where sku='682200007014' order by tanggal,source_row_number) j),
 'sync',(select jsonb_agg(j) from (select source,status,last_success_at,locked_at from public.inventory_sync_status order by source) j),
 'transfer_labels',(select jsonb_agg(j) from (select status,keterangan,count(*) as rows from public.inventory_barang_masuk where upper(coalesce(keterangan,'')) like '%TRANSFER%' or upper(coalesce(status,'')) like '%MOVEMENT%' group by status,keterangan) j)
 ) as audit`;
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
 if(!response.ok){console.error(`::error::Read-only movement audit failed: HTTP ${response.status}`);process.exit(1);}
 const audit=(await response.json())?.[0]?.audit;
 if(!audit)throw new Error('Movement audit unavailable');
 for(const [key,value] of Object.entries(audit))console.log(`::notice title=Movement ${key}::`+JSON.stringify(value));
 process.exit(0);
}
if(process.argv.includes('--movement-preview'))await import('./deploy-warning-rules.mjs');
if(process.argv.includes('--validate')||process.argv.includes('--movement-preview')){
 const {loadInventoryWarnings}=await import('../functions/api/_inventory-warnings.js');
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error('Audit server credential unavailable');
 const keys=await response.json(),key=keys.find(item=>String(item.api_key||'').startsWith('sb_secret_'))?.api_key;
 if(!key)throw new Error('Audit server credential unavailable');
 let result;
 for(let attempt=0;attempt<4;attempt++){
  result=await loadInventoryWarnings({SUPABASE_URL:`https://${project}.supabase.co`,SUPABASE_SECRET_KEY:key},process.argv.includes('--movement-preview')?{full:true}:{page:1,limit:1});
  if(result.verification.filter(item=>process.argv.includes('--require-ledger')||process.argv.includes('--movement-preview')||['kartu_stok','rpl','bulky'].includes(item.source)).every(item=>item.ready))break;
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 const report={summary:result.summary,partial:result.partial,coverage:result.verification.map(item=>({source:item.source,ready:item.ready,rowCount:item.rowCount,reason:item.reason,readStatus:item.readStatus,readCode:item.readCode})),checks:result.checks};
 console.log('::notice title=Warning validation::'+JSON.stringify(report));
 if(process.argv.includes('--movement-preview')){const findings=result.rows.filter(row=>row.category.startsWith('MOVEMENT_'));console.log('::notice title=Movement detection preview::'+JSON.stringify({total:findings.length,reportedSkuDetected:findings.some(row=>row.sku==='682200007014'),sample:findings.slice(0,25).map(row=>({sku:row.sku,category:row.category,issue:row.issue,evidence:row.evidence}))}));}
 if(result.verification.filter(item=>process.argv.includes('--require-ledger')||process.argv.includes('--movement-preview')||['kartu_stok','rpl','bulky'].includes(item.source)).some(item=>!item.ready)){
  const statusResponse=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:'select source,status,last_success_at,locked_at,source_version from public.inventory_sync_status order by source'}),signal:AbortSignal.timeout(30000)});
  if(statusResponse.ok)console.log('::notice title=Warning source sync status::'+JSON.stringify(await statusResponse.json()));
  console.error('::error::Read-only warning validation could not obtain a stable stock snapshot');process.exit(1);
 }
 process.exit(0);
}
const query=`
with rows as (
 select to_jsonb(s) as j from public.inventory_kartu_stok s
), numeric_rows as (
 select j, (j->>'stok_awal')::numeric as a,(j->>'internal_stock_transfer')::numeric as i,(j->>'replenishment')::numeric as r,(j->>'pengeluaran')::numeric as p,(j->>'stok_akhir')::numeric as c
 from rows where (j->>'stok_awal') ~ '^-?[0-9]+([.][0-9]+)?$' and (j->>'internal_stock_transfer') ~ '^-?[0-9]+([.][0-9]+)?$' and (j->>'replenishment') ~ '^-?[0-9]+([.][0-9]+)?$' and (j->>'pengeluaran') ~ '^-?[0-9]+([.][0-9]+)?$' and (j->>'stok_akhir') ~ '^-?[0-9]+([.][0-9]+)?$'
)
select jsonb_build_object(
 'balance_formulas',(select jsonb_build_object('complete_rows',count(*),'plus_plus',count(*) filter(where abs(a+i+r-p-c)<0.000001),'minus_minus',count(*) filter(where abs(a-i-r-p-c)<0.000001),'plus_minus',count(*) filter(where abs(a+i-r-p-c)<0.000001),'minus_plus',count(*) filter(where abs(a-i+r-p-c)<0.000001),'active_transfer_rows',count(*) filter(where i<>0 or r<>0)) from numeric_rows),
 'unmatched_balance',(select jsonb_agg(to_jsonb(v)) from (select j->>'sku' as sku,j->>'lokasi_bulky' as location,a,i,r,p,c from numeric_rows where abs(a-i-r-p-c)>0.000001 limit 12) v),
 'outbound_detail',(select jsonb_agg(to_jsonb(v)) from (select sku,nama_barang,tanggal,qty,status,keterangan,from_location,to_location,source_row_number from public.inventory_barang_keluar where public.inventory_normalize_sku(sku)='681565407499' order by source_row_number desc limit 8) v),
 'reference_coverage',(select jsonb_agg(to_jsonb(v)) from (select 'rpl' as source,count(*) as rows,count(*) filter(where netsuite is null) as no_reference,count(*) filter(where selisih is null) as no_difference from public.inventory_rpl union all select 'bulky',count(*),count(*) filter(where netsuite is null),count(*) filter(where selisih is null) from public.inventory_bulky) v)
) as audit;
`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok){console.error(`::error::Read-only warning audit failed: HTTP ${response.status}`);process.exit(1);}
const rows=await response.json(),audit=rows?.[0]?.audit;if(!audit)throw new Error('Audit result unavailable');
for(const [key,value] of Object.entries(audit)){const encoded=JSON.stringify({[key]:value}).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');console.log(`::notice title=Warning audit::${encoded}`);}
