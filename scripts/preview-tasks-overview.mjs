// Fictional local browser QA, without env files, providers, worker or Supabase.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const dir = resolve(".local/tasks-overview-qa");
mkdirSync(dir, { recursive: true });
await build({
  entryPoints: ["tests/fixtures/tasks-overview-ui.tsx"],
  bundle: true,
  outfile: resolve(dir, "bundle.js"),
  platform: "browser",
  external: ["/pipeline-os/*"],
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  tsconfig: "tsconfig.json",
});
if (process.argv.includes("--build-only")) process.exit(0);
const html =
  '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tareas abiertas — QA ficticia local</title><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/bundle.css"><style>#fixture-tools{padding:8px 20px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;font:12px system-ui;background:#fff}#fixture-tools button{padding:5px 10px}#fixture-tools button[aria-pressed=true]{background:#e2eee8}</style><div id="root"></div><script src="/bundle.js"></script></html>';
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; object-src 'none'",
  );
  const files = {
    "/bundle.js": ["text/javascript", resolve(dir, "bundle.js")],
    "/bundle.css": ["text/css", resolve(dir, "bundle.css")],
    "/globals.css": ["text/css", resolve("src/app/globals.css")],
    "/pipeline-os/fonts/instrument-sans-latin.woff2": [
      "font/woff2",
      resolve("public/pipeline-os/fonts/instrument-sans-latin.woff2"),
    ],
    "/pipeline-os/fonts/instrument-serif-latin.woff2": [
      "font/woff2",
      resolve("public/pipeline-os/fonts/instrument-serif-latin.woff2"),
    ],
  };
  const file = files[req.url];
  if (file) {
    res.setHeader("Content-Type", file[0]);
    res.end(readFileSync(file[1]));
  } else if (req.url === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  }
});
server.listen(0, "127.0.0.1", () =>
  process.stdout.write(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}`,
      realCalls: 0,
    }) + "\n",
  ),
);
process.on("SIGINT", () => server.close(() => process.exit(0)));
