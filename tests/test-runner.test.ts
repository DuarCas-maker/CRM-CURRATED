import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("standard test command discovers TypeScript and TSX tests without private local files", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts.test, "node scripts/run-tests.mjs");
  const result = spawnSync(
    process.execPath,
    ["scripts/run-tests.mjs", "--list"],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout) as string[];
  assert.ok(
    files.includes("pipeline-os-composio-verification-setup-ui.test.tsx"),
  );
  assert.ok(files.includes("ui-accessibility.test.tsx"));
  assert.deepEqual(
    files,
    readdirSync("tests")
      .filter((name) => /\.test\.(ts|tsx)$/.test(name))
      .sort(),
  );
  for (const file of [
    "tests/pipeline-os-composio-verification-setup-http.test.ts",
    "tests/pipeline-os-s02-quota-i04-http.test.ts",
  ]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\.local\//);
  }
});
