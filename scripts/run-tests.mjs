import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(new URL("../tests/", import.meta.url))
  .filter((name) => /\.test\.(ts|tsx)$/.test(name))
  .sort();
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--list") {
  console.log(JSON.stringify(files));
} else {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "./tests/offline.mjs",
      "--import",
      "tsx",
      "--test",
      // Several files create embedded databases. Bound memory use on local QA.
      "--test-concurrency=2",
      ...args,
      ...files.map((name) =>
        fileURLToPath(new URL("../tests/" + name, import.meta.url)),
      ),
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
