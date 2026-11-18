import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const folder = resolve(".local/simple-mail-preview");
mkdirSync(folder, { recursive: true });
await build({
  entryPoints: ["tests/fixtures/simple-mail-browser.tsx"],
  bundle: true,
  outfile: resolve(folder, "bundle.js"),
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  define: { "process.env.NODE_ENV": '"development"' },
});
if (process.argv.includes("--build-only")) process.exit(0);
const html =
  '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conexiones — QA local ficticia</title><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/bundle.css"><style>body{padding:20px}main{max-width:1180px;margin:auto}.qa-label{font-size:12px;color:#726b60}output{display:block;overflow-wrap:anywhere}</style><div id="root"></div><script src="/bundle.js"></script></html>';
const files = {
  "/globals.css": ["text/css", "src/app/globals.css"],
  "/bundle.js": ["text/javascript", resolve(folder, "bundle.js")],
  "/bundle.css": ["text/css", resolve(folder, "bundle.css")],
};
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; object-src 'none'; img-src 'self' data:",
  );
  const pathname = new URL(req.url, "http://fixture.invalid").pathname;
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  if (pathname === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
    return;
  }
  const file = files[pathname];
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("Content-Type", file[0]);
  res.end(readFileSync(file[1]));
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}/`,
      fictional: true,
      realProviders: false,
    }),
  ),
);
process.on("SIGINT", () => server.close(() => process.exit(0)));
