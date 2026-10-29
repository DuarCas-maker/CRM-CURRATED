-- Follow-up for the table missing from the user-provided S00 catalog.
-- READ ONLY: catalog metadata only; no lender rows or business function calls.
begin transaction read only;
set local statement_timeout = '5s';

select jsonb_build_object(
  'inventory_kind', 'lender_guidelines_catalog_only',
  'objects', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema_name', n.nspname,
      'object_name', c.relname,
      'relation_kind', c.relkind,
      'rls_enabled', c.relrowsecurity,
      'policy_count', (select count(*) from pg_catalog.pg_policy p where p.polrelid = c.oid),
      'columns', coalesce((
        select jsonb_agg(a.attname order by a.attnum)
        from pg_catalog.pg_attribute a
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      ), '[]'::jsonb)
    ) order by n.nspname, c.relname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'lender_guideline_versions'
  ), '[]'::jsonb),
  'lenders_columns', coalesce((
    select jsonb_agg(a.attname order by a.attname)
    from pg_catalog.pg_attribute a
    where a.attrelid = to_regclass('public.lenders')
      and a.attnum > 0 and not a.attisdropped
      and a.attname in ('guidelines', 'guideline_version')
  ), '[]'::jsonb),
  'functions', jsonb_build_object(
    'save_lender_guidelines', to_regprocedure('public.save_lender_guidelines(uuid,jsonb,integer,uuid)') is not null,
    'import_lender_directory', to_regprocedure('public.import_lender_directory(jsonb,uuid)') is not null,
    'snapshot_underwriting_lender_guidelines', to_regprocedure('public.snapshot_underwriting_lender_guidelines()') is not null
  ),
  'underwriting_snapshot_trigger', exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = to_regclass('public.underwriting_runs')
      and t.tgname = 'underwriting_lender_guideline_snapshot'
      and not t.tgisinternal
  )
) as s00_lender_guidelines_inventory;

rollback;
