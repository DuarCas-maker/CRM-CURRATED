-- Standalone statement: CONCURRENTLY must not run inside BEGIN/COMMIT.
CREATE INDEX CONCURRENTLY IF NOT EXISTS workspace_import_rows_imported_contact_idx
ON public.import_rows (contact_id)
WHERE result = 'imported';
