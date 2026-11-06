import { readFile } from "node:fs/promises";
import { featureDatabase } from "../feature-database";
import {
  diagnosticRoot,
  loadScope,
  parseDiagnostic,
  renderDiagnosticSql,
} from "../../scripts/pipeline-os/catalog-permissions";

export async function permissionsFixture() {
  const f = await featureDatabase();
  try {
    const scope = await loadScope(),
      sql = await renderDiagnosticSql(scope);
    const snapshot = async () => {
      try {
        const results = await f.db.exec(sql);
        const row = results
          .flatMap((r) => r.rows as Record<string, unknown>[])
          .find((r) => r.pipeline_os_abc_permissions_diagnostic);
        return parseDiagnostic(
          row?.pipeline_os_abc_permissions_diagnostic,
          scope,
        );
      } catch (error) {
        await f.db.exec("rollback");
        throw error;
      }
    };
    return { ...f, scope, sql, snapshot, reference: await snapshot() };
  } catch (error) {
    await f.db.close();
    throw error;
  }
}

export async function fixedDiagnosticSql() {
  return readFile(diagnosticRoot + "diagnostic.sql", "utf8");
}
