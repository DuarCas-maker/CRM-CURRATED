-- Run in the SQL editor of the current authorized Supabase instance.
-- Metadata only. No application rows, SQL writes, migrations or credentials.
begin transaction read only;
set local statement_timeout = '5s';

select jsonb_build_object(
  'inventory_kind', 'catalog_only_not_migration_history',
  'migration_ledger_available', to_regclass('supabase_migrations.schema_migrations') is not null,
  'markers', jsonb_build_object(
    'core_contacts_table', to_regclass('public.contacts') is not null,
    'lead_workspace_view', to_regclass('public.lead_workspace') is not null,
    'migration_031_settings_table', to_regclass('public.operational_settings') is not null,
    'migration_043_first_contact_column', exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'campaigns' and column_name = 'first_contact'
    ),
    'migration_044_tracking_function', to_regprocedure('public.lead_campaign_tracking(uuid)') is not null,
    'migration_045_readiness_function', to_regprocedure('public.campaign_readiness_page(text,text,integer)') is not null
  ),
  'public_tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table_name', c.relname,
      'rls_enabled', c.relrowsecurity,
      'policy_count', (select count(*) from pg_catalog.pg_policy p where p.polrelid = c.oid)
    ) order by c.relname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ), '[]'::jsonb)
) as s00_metadata_inventory;

rollback;
