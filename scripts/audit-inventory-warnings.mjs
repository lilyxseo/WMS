// Read-only statistics and small operational samples. No user profiles, tokens,
// document URLs, or full transaction ledgers are exported.
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('Audit configuration unavailable');
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
