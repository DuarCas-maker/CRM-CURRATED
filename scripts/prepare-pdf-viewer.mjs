import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const target = resolve("public/pdfjs");
await mkdir(target, { recursive: true });
await cp(
  resolve(source, "build/pdf.worker.min.mjs"),
  resolve(target, "pdf.worker.min.mjs"),
);
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(resolve(source, directory), resolve(target, directory), {
    recursive: true,
  });
}
