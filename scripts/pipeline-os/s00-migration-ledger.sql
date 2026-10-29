-- Optional second query. Run only when migration_ledger_available was true.
-- An absent ledger can mean manual SQL installation, not an empty database.
begin transaction read only;
set local statement_timeout = '5s';

select version
from supabase_migrations.schema_migrations
order by version;

rollback;
