import { readFile, writeFile } from "node:fs/promises";
import { abcPreflightRoot } from "./abc-preflight";
import { renderAbcFinalDiagnostic } from "./abc-final-diagnostic";
import { restoreCatalogPrior } from "./abc-catalog-variants";

// Reproduce the historical diagnostic already used by the operator; do not
// overwrite its evidence with a different migration revision.
const prior = await restoreCatalogPrior({
  migration: await readFile(
    abcPreflightRoot + "049_integrate_mail_identity_brands_and_bindings.sql",
    "utf8",
  ),
  contract: await readFile(abcPreflightRoot + "contract.json", "utf8"),
  postflight: await readFile(abcPreflightRoot + "postflight.sql", "utf8"),
});
const sql = renderAbcFinalDiagnostic(prior.migration, prior.contract);
await writeFile(
  abcPreflightRoot + "failure-diagnostic/diagnostic.rollback.sql",
  sql,
);
console.log("AF-FDIAG-r1: prepared locally; SQL executions=0, remote calls=0");
