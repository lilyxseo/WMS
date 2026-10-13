// Read-only statistics and small operational samples. No user profiles, tokens,
// document URLs, or full transaction ledgers are exported.
const project=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!project||!token)throw new Error('Audit configuration unavailable');
const query=`
with snapshots as (
 select 'kartuStok' as source,to_jsonb(s) as j from public.inventory_kartu_stok s
 union all select 'rpl',to_jsonb(s) from public.inventory_rpl s
 union all select 'bulky',to_jsonb(s) from public.inventory_bulky s
), classified as (
 select source,j,btrim(coalesce(j->>'sku','')) as sku,btrim(coalesce(j->>'nama_barang','')) as name,
 btrim(coalesce(j->>'lokasi_bulky','')) as location,
 case when coalesce(j->>'stok_akhir','') ~ '^-?[0-9]+([.][0-9]+)?$' then (j->>'stok_akhir')::numeric end as stock
 from snapshots
), variants as (
 select sku,jsonb_agg(jsonb_build_object('source',source,'name',name,'stock',stock,'location',location)) as variants
 from classified where sku<>'' and stock>0 group by sku
 having count(distinct upper(regexp_replace(name,'[[:space:]]+',' ','g')))>1
), missing as (select * from public.inventory_outbound_without_inbound())
select jsonb_build_object(
 'schema',(select jsonb_object_agg(table_name,cols) from (select table_name,jsonb_agg(column_name order by ordinal_position) as cols from information_schema.columns where table_schema='public' and table_name in ('inventory_kartu_stok','inventory_rpl','inventory_bulky','inventory_sync_status') group by table_name) a),
 'sync',(select jsonb_agg(to_jsonb(s)) from public.inventory_sync_status s),
 'snapshots',(select jsonb_agg(to_jsonb(a)) from (select source,count(*) as rows,count(*) filter(where sku='') as blank_sku,count(*) filter(where name='') as blank_name,count(*) filter(where stock>0 and location='') as positive_missing_location,count(*) filter(where stock<0) as negative,count(*) filter(where stock=0) as zero_stock from classified group by source) a),
 'name_conflict_count',(select count(*) from variants),
 'name_examples',(select jsonb_agg(to_jsonb(a)) from (select * from variants order by sku limit 8) a),
 'negative_examples',(select jsonb_agg(to_jsonb(a)) from (select source,sku,name,location,stock,j->>'stok_awal' as opening,j->>'internal_stock_transfer' as internal,j->>'replenishment' as replenish,j->>'pengeluaran' as outgoing,j->>'netsuite' as netsuite,j->>'selisih' as selisih from classified where stock<0 order by source,sku limit 12) a),
 'accuracy_examples',(select jsonb_agg(to_jsonb(a)) from (select sku,name,stock,j->>'netsuite' as netsuite,j->>'selisih' as selisih from classified where source='bulky' and coalesce(j->>'selisih','') not in ('','0','0.0','0.00') order by sku limit 10) a),
 'blank_examples',(select jsonb_agg(to_jsonb(a)) from (select source,sku,name,location,stock from classified where sku='' or name='' or (stock>0 and location='') limit 10) a),
 'outbound_missing_count',(select count(*) from missing),
 'outbound_missing_with_snapshot',(select count(*) from missing m where exists(select 1 from classified c where public.inventory_normalize_sku(c.sku)=public.inventory_normalize_sku(m.sku))),
 'outbound_examples',(select jsonb_agg(to_jsonb(a)) from (select m.sku,m.nama_barang,(select jsonb_agg(jsonb_build_object('source',c.source,'opening',c.j->>'stok_awal','stock',c.stock)) from classified c where public.inventory_normalize_sku(c.sku)=public.inventory_normalize_sku(m.sku)) as stock_evidence from missing m order by m.sku limit 10) a)
) as audit;
`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok){console.error(`::error::Read-only warning audit failed: HTTP ${response.status}`);process.exit(1);}
const rows=await response.json(),audit=rows?.[0]?.audit;if(!audit)throw new Error('Audit result unavailable');
for(const [key,value] of Object.entries(audit)){const encoded=JSON.stringify({[key]:value}).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');console.log(`::notice title=Warning audit::${encoded}`);}
