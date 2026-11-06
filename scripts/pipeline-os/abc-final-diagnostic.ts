import assert from "node:assert/strict";
import { sha256 } from "./abc-preflight";
import { catalogPriorPins as pins } from "./abc-catalog-variants";

export const finalFailureGuard =
  "if not ok then raise exception 'ABC_FINAL_CONTRACT_MISMATCH';end if;";
export const finalDeclaration = "fingerprint text;begin";
export const diagnosticDeclaration = `fingerprint text;
 fd_field text;fd_details jsonb:='[]';fd_count integer:=0;fd_inventory_ok boolean;
 fd_missing jsonb;fd_extra jsonb;fd_missing_count integer;fd_extra_count integer;
 fd_report jsonb;begin`;
export const finalReceiptSelect =
  "select current_setting('pipeline_os.abc_receipt')::jsonb pipeline_os_abc_application;\ncommit;";

/** Additional evidence only: same rejected fields, no extra accepted values. */
export function diagnosticFailureGuard(
  migrationSha: string,
  contractSha: string,
) {
  assert(/^[a-f0-9]{64}$/.test(migrationSha));
  assert(/^[a-f0-9]{64}$/.test(contractSha));
  return `if not ok then
 for g in select jsonb_object_keys(expected) order by 1 loop
  for k,v in select * from jsonb_each(expected->g) order by key loop
   a:=coalesce(observed->g->k,'null'::jsonb);
   if v='null'::jsonb or a='null'::jsonb then
    if a is distinct from v then
     fd_count:=fd_count+1;
     if jsonb_array_length(fd_details)<40 then
      fd_details:=fd_details||jsonb_build_array(jsonb_build_object('group',g,'object',left(k,256),'field','presence'));
     end if;
    end if;
   else
    for fd_field in select jsonb_object_keys(v) union select jsonb_object_keys(a) order by 1 loop
     if g='functions' and fd_field='sourceHash'
      and coalesce((coalesce(d->'postSourceVariants'->k,jsonb_build_array(v->>'sourceHash')))?(a->>'sourceHash'),false) then continue;end if;
     if a->fd_field is distinct from v->fd_field then
      fd_count:=fd_count+1;
      if jsonb_array_length(fd_details)<40 then
       fd_details:=fd_details||jsonb_build_array(jsonb_build_object('group',g,'object',left(k,256),'field',fd_field,
        'expectedFingerprint',md5(coalesce((v->fd_field)::text,'SQL_NULL')),
        'observedFingerprint',md5(coalesce((a->fd_field)::text,'SQL_NULL'))));
      end if;
     end if;
    end loop;
   end if;
  end loop;
 end loop;
 select count(*),coalesce(jsonb_agg(key order by key) filter(where ordinal<=20),'[]') into fd_missing_count,fd_missing
 from (select key,row_number() over(order by key) ordinal from jsonb_array_elements_text(d->'finalFunctionNames') key
  where not (observed->'functions')?key) missing;
 select count(*),coalesce(jsonb_agg(key order by key) filter(where ordinal<=20),'[]') into fd_extra_count,fd_extra
 from (select key,row_number() over(order by key) ordinal from jsonb_object_keys(observed->'functions') key
  where not (d->'finalFunctionNames')?key) extra;
 fd_inventory_ok:=fd_missing_count=0 and fd_extra_count=0;
 fd_report:=jsonb_build_object('protocol','AF-FDIAG-r1','ordinal','049','stage','failed_before_commit',
  'sourceMigrationSha256','${migrationSha}','contractSha256','${contractSha}',
  'version',current_setting('server_version_num'),'collation',(select datcollate from pg_database where datname=current_database()),
  'mismatchCount',fd_count+fd_missing_count+fd_extra_count,'fieldMismatchCount',fd_count,
  'details',fd_details,'detailsTruncated',fd_count>jsonb_array_length(fd_details),
  'functionInventory',jsonb_build_object('ok',fd_inventory_ok,'missingCount',fd_missing_count,'extraCount',fd_extra_count,
   'missingFirst20',fd_missing,'extraFirst20',fd_extra,'truncated',fd_missing_count>20 or fd_extra_count>20),
  'allGuardsRetained',true,'commitAllowed',false);
 raise exception using errcode='P0001',message='ABC_FINAL_CONTRACT_MISMATCH',detail=fd_report::text,
  hint='Conservar DETAIL. No reintentar 049. Limpiar la transaccion fallida con ROLLBACK.';
end if;`;
}

export function diagnosticReceiptSelect(
  migrationSha: string,
  contractSha: string,
) {
  assert(/^[a-f0-9]{64}$/.test(migrationSha));
  assert(/^[a-f0-9]{64}$/.test(contractSha));
  return `select jsonb_build_object('protocol','AF-FDIAG-r1','ordinal','049','stage','checked_before_rollback',
 'sourceMigrationSha256','${migrationSha}','contractSha256','${contractSha}',
 'version',current_setting('server_version_num'),'mismatchCount',0,'commitAllowed',false,
 'protectedBefore',current_setting('pipeline_os.abc_protected_before'),
 'protectedAfter',(current_setting('pipeline_os.abc_receipt')::jsonb)->>'protectedAfter') pipeline_os_abc_final_diagnostic;
rollback;`;
}

export function renderAbcFinalDiagnostic(
  migration: string,
  contractText: string,
) {
  assert.equal(sha256(migration), pins.migration, "Unreviewed migration");
  assert.equal(sha256(contractText), pins.contract, "Unreviewed contract");
  const contract = JSON.parse(contractText);
  assert.equal(contract.ordinal, "049");
  assert.equal(contract.protocol, "ABC-FINAL-r1");
  assert(migration.includes(pins.contract));
  const start = migration.lastIndexOf("do $af_check$");
  assert(start > 0);
  const prefix = migration.slice(0, start);
  const original = migration.slice(start);
  for (const marker of [
    finalDeclaration,
    finalFailureGuard,
    finalReceiptSelect,
  ])
    assert.equal(original.split(marker).length - 1, 1, "Unexpected SQL shape");
  assert(original.trimEnd().endsWith(finalReceiptSelect));
  const suffix = original
    .replace(finalDeclaration, diagnosticDeclaration)
    .replace(
      finalFailureGuard,
      diagnosticFailureGuard(pins.migration, pins.contract),
    )
    .replace(
      finalReceiptSelect,
      diagnosticReceiptSelect(pins.migration, pins.contract),
    );
  assert.equal(
    suffix
      .replace(diagnosticDeclaration, finalDeclaration)
      .replace(
        diagnosticFailureGuard(pins.migration, pins.contract),
        finalFailureGuard,
      )
      .replace(
        diagnosticReceiptSelect(pins.migration, pins.contract),
        finalReceiptSelect,
      ),
    original,
    "Unexpected modification outside diagnostic evidence",
  );
  return `-- AF-FDIAG-r1: PREPARED ONLY, NOT REMOTE EXECUTION AUTHORIZATION.
-- Contains transactional DDL/DCL/backfill and locks; this is NOT READ ONLY.
-- Run only as a separately authorized diagnostic on the verified CRM project.
-- No COMMIT: successful path ends in ROLLBACK. On error preserve DETAIL and
-- issue ROLLBACK separately if the client stops before reaching the last line.
-- Source049 SHA256 ${pins.migration}
-- Contract SHA256 ${pins.contract}
${prefix}${suffix}`;
}
