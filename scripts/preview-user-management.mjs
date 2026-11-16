// Fictional local UI fixture. No env loader, Supabase, worker or external calls.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const dir = resolve(".local/user-management/visual");
mkdirSync(dir, { recursive: true });
await build({
  entryPoints: ["tests/fixtures/user-management-ui.tsx"],
  bundle: true,
  outfile: resolve(dir, "bundle.js"),
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  tsconfig: "tsconfig.json",
});
if (process.argv.includes("--build-only")) process.exit(0);
const html =
  '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Usuarios — QA ficticia local</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/users.css"><style>body{padding:24px}main{max-width:1120px;margin:auto}#fixture-tools{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}</style><main><p>QA local — usuarios y textos ficticios; cero operaciones reales.</p><div id="root"></div></main><script src="/bundle.js"></script></html>';
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; object-src 'none'",
  );
  const files = {
    "/bundle.js": ["text/javascript", resolve(dir, "bundle.js")],
    "/style.css": ["text/css", "src/app/globals.css"],
    "/users.css": ["text/css", "src/components/user-management.css"],
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
