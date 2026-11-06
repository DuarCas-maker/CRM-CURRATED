import { readFile, writeFile } from "node:fs/promises";
import { abcPreflightRoot, renderAbcPreflight } from "./abc-preflight";

// Local artifact preparation only. Does not connect, execute SQL or read env.
const sql = renderAbcPreflight(
  await readFile(
    abcPreflightRoot + "049_integrate_mail_identity_brands_and_bindings.sql",
    "utf8",
  ),
  await readFile(abcPreflightRoot + "contract.json", "utf8"),
);
await writeFile(abcPreflightRoot + "preflight/preflight.sql", sql);
console.log("AF-PRE-r1: preflight prepared locally; SQL executions=0");
