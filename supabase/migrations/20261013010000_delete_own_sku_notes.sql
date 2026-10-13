-- Only the authenticated server endpoint deletes notes. It applies the verified
-- author_id together with note ID and SKU in the DELETE filter. Browser roles
-- keep no direct table privileges and no RLS policies are broadened.
grant delete on public.sku_notes to service_role;
notify pgrst, 'reload schema';
