-- Search all business columns in PostgreSQL before sending matching rows to
-- Pages. Existing date normalization/natural ordering stays in the read layer.
-- No stock or ledger rows are changed.
create extension if not exists pg_trgm with schema extensions;
do $migration$
declare
 table_name text;
 expression text;
 trigram_schema text;
 function_name text;
 body text;
begin
 select n.nspname into trigram_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
 foreach table_name in array array['inventory_barang_masuk','inventory_barang_keluar'] loop
  select string_agg(format($column$coalesce(%I::text, '')$column$,f.name), $separator$ || ' ' || $separator$ order by f.position)
  into expression
  from unnest(array['tanggal','from_location','to_location','sku','nama_barang','qty','status','pic','keterangan','no_iseller','netsuite','keterangan_lainnya','lokasi_surat_jalan','stockout','status_lanjutan','no_iseller_awal','dokumen']) with ordinality as f(name,position)
  join pg_attribute a on a.attrelid=format('public.%I',table_name)::regclass and a.attname=f.name and a.attnum>0 and not a.attisdropped;
  if expression is null then raise exception 'Transaction schema unavailable'; end if;
  expression:=format($expression$lower(normalize(regexp_replace((%s),'[[:space:]]+',' ','g'),NFKC))$expression$,expression);
  execute format('create index if not exists %I on public.%I using gin ((%s) %I.gin_trgm_ops)',table_name||'_business_search_trgm',table_name,expression,trigram_schema);
  function_name:='wms_search_'||replace(table_name,'inventory_','');
  body:=format($body$
   declare term text; pattern text; sql text:=%L;
   begin
    if char_length(p_query)>500 then raise exception 'Search query exceeds 500 characters' using errcode='22023'; end if;
    foreach term in array regexp_split_to_array(lower(normalize(btrim(coalesce(p_query,'')),NFKC)),'[[:space:]]+') loop
     if term='' then continue; end if;
     pattern:='%%'||replace(replace(replace(term,chr(92),chr(92)||chr(92)),'%%',chr(92)||'%%'),'_',chr(92)||'_')||'%%';
     sql:=sql||format(' AND (%%s) LIKE %%L',%L,pattern);
    end loop;
    return query execute sql;
   end;
  $body$,format('select * from public.%I where true',table_name),expression);
  execute format('create or replace function public.%I(p_query text) returns setof public.%I language plpgsql stable security invoker set search_path=public,pg_temp as %L',function_name,table_name,body);
  execute format('revoke all on function public.%I(text) from public,anon,authenticated',function_name);
  execute format('grant execute on function public.%I(text) to service_role',function_name);
 end loop;
end;
$migration$;
notify pgrst,'reload schema';
