import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Bundle, demand, hash, within } from "./types";
export const finalRoot = "docs/specs/pipeline-os/s02/release/abc-final/";
export const prmRoot =
  "docs/specs/pipeline-os/s02/release/permission-remediation/";
export const pins = {
  migration: "1ee6dab9911777f4fae3f912ad6a679d17ad9fb88e79ae8479f20df541171f39",
  postflight:
    "dd192f1983ccd4a4d3f8ecf014869bf696076e75710d0b2284e92467b30456dd",
  preflight: "b39f472286b89cac22553d649adab10b722b8ea37c623ca43709ddf3428786e8",
  contract: "e9b0928a431e8bb8106d8004d42b057ae3d66607d21050c25dc4804d4e36083c",
};
export async function loadBundle(workspace: string): Promise<Bundle> {
  const root = await realpath(workspace);
  const manifest = JSON.parse(
    await readFile(
      path.join(root, finalRoot, "pg15-rehearsal/manifest.json"),
      "utf8",
    ),
  );
  demand(
    manifest.id === "AF-PG15-r1" && manifest.artifacts.length === 58,
    "QA_INPUT_MANIFEST",
  );
  const files = new Map<string, string>();
  for (const item of manifest.artifacts) {
    demand(
      typeof item.path === "string" &&
        !item.path.includes("\\") &&
        !item.path.split("/").some((p: string) => p.startsWith(".")) &&
        !files.has(item.path),
      "QA_INPUT_PATH",
    );
    const resolved = await realpath(path.resolve(root, item.path));
    demand(within(root, resolved), "QA_INPUT_PATH");
    const bytes = await readFile(resolved);
    demand(
      hash(bytes) === item.sha256 && bytes.length === item.bytes,
      "QA_INPUT_HASH",
    );
    files.set(item.path, bytes.toString("utf8"));
  }
  const contract = JSON.parse(files.get(finalRoot + "contract.json")!);
  for (const source of contract.sourceFiles) {
    demand(
      source.path.startsWith("docs/specs/pipeline-os/s02/integration/") &&
        !source.path.includes(".."),
      "QA_SOURCE_CONTRACT",
    );
    const resolved = await realpath(path.resolve(root, source.path));
    demand(within(root, resolved), "QA_INPUT_PATH");
    const bytes = await readFile(resolved);
    demand(hash(bytes) === source.sha256, "QA_SOURCE_HASH");
    files.set(source.path, bytes.toString());
  }
  return bundleFromFiles(files);
}
export function bundleFromFiles(files: Map<string, string>): Bundle {
  const names = {
    migration: "049_integrate_mail_identity_brands_and_bindings.sql",
    postflight: "postflight.sql",
    preflight: "preflight/preflight.sql",
    contract: "contract.json",
  };
  const values = {} as Record<keyof typeof names, string>;
  for (const [kind, file] of Object.entries(names) as [
    keyof typeof names,
    string,
  ][]) {
    const value = files.get(finalRoot + file);
    demand(value && hash(value) === pins[kind], "QA_ARTIFACT_HASH");
    values[kind] = value;
  }
  const migrations = [...files.keys()]
    .filter((p) => p.startsWith("supabase/migrations/"))
    .sort();
  demand(
    migrations.length === 47 &&
      migrations.every((p, i) =>
        p.startsWith(`supabase/migrations/${String(i + 1).padStart(3, "0")}_`),
      ),
    "QA_MIGRATION_INVENTORY",
  );
  const contract = JSON.parse(values.contract);
  for (const source of contract.sourceFiles) {
    // Source SQL is already bound to the sealed payload; these are not executed.
    demand(
      source.path.startsWith("docs/specs/pipeline-os/s02/integration/") &&
        /^[a-f0-9]{64}$/.test(source.sha256),
      "QA_SOURCE_CONTRACT",
    );
  }
  demand(
    values.migration.includes(pins.contract) &&
      values.postflight.includes(pins.contract),
    "QA_CONTRACT_BINDING",
  );
  return {
    files,
    ...values,
    contract,
    contractSha: pins.contract,
    migrationSha: pins.migration,
    inputHashes: Object.fromEntries([...files].map(([p, s]) => [p, hash(s)])),
  };
}
