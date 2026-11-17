-- Run only with explicit environment authorization. Preserve template data and
-- saved recipient selections. Roll application back before running this file.
begin;
do $$ declare item record;begin
 for item in select * from lender_composer_private.previous_functions loop
  execute item.definition;
 end loop;
end $$;
-- No destructive down migration: leave the compatible template tables/RLS and
-- wider selection constraint in place. Older app cannot create oversized lots.
notify pgrst,'reload schema';
commit;
