-- Reconstruct the sync engine's SHA-256 over ordered [source_row_key,source_hash]
-- pairs. Only a matching last-success fingerprint may be used after sync fails.
create or replace function public.inventory_warning_snapshot_signatures()
returns table(source text,content_version text,row_count bigint)
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare item record;
begin
 for item in select * from (values('kartu_stok','inventory_kartu_stok'),('rpl','inventory_rpl'),('bulky','inventory_bulky'),('barang_masuk','inventory_barang_masuk'),('barang_keluar','inventory_barang_keluar')) as sources(source_key,table_name) loop
  return query execute format($query$
   select %L::text,case when count(*) filter(where source_row_key is null or source_hash is null)>0 then null else
    encode(sha256(convert_to('['||coalesce(string_agg('['||to_json(source_row_key)::text||','||to_json(source_hash)::text||']',',' order by source_row_number,id),'')||']','UTF8')),'hex') end,count(*)
   from public.%I
  $query$,item.source_key,item.table_name);
 end loop;
end;
$$;
revoke all on function public.inventory_warning_snapshot_signatures() from public,anon,authenticated;
grant execute on function public.inventory_warning_snapshot_signatures() to service_role;
notify pgrst,'reload schema';
