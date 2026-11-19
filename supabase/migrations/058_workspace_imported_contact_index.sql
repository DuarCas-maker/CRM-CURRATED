-- Bootstrap / transactional migration form. Live production uses the equivalent
-- standalone CONCURRENTLY statement in the reviewed application-performance runbook.
CREATE INDEX IF NOT EXISTS workspace_import_rows_imported_contact_idx
ON public.import_rows (contact_id)
WHERE result = 'imported';
