// Local visual fixture only. No env loader, DB, credentials or provider clients.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const dir = resolve(".local/pipeline-os/qgr-i04/visual");
mkdirSync(dir, { recursive: true });
await build({
  entryPoints: ["tests/fixtures/quota-i04-ui.tsx"],
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
  '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>I04 revisión ficticia local</title><link rel="stylesheet" href="/style.css"><style>body{padding:24px;background:#f4f0e7}main{max-width:1040px;margin:auto}.settings-card{background:#f8f5ee;border:1px solid #b8a78c;border-radius:14px;padding:24px}label{display:grid;gap:8px;margin:12px 0}select,input{max-width:100%;padding:10px;border:1px solid #97846a;border-radius:6px;background:#fff}button{margin:8px 0;padding:10px 16px}p{overflow-wrap:anywhere}fieldset legend{margin-top:24px;font-weight:bold}.modal{max-width:min(560px,calc(100vw - 24px))}#audit{font-size:12px;color:#665}</style><main><p>Ensayo visual ficticio local — Composio apagado</p><div id="root"></div><p id="audit">POST ficticios: 0; llamadas reales: 0</p></main><script src="/bundle.js"></script></html>';
writeFileSync(resolve(dir, "index.html"), html);
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; object-src 'none'",
  );
  if (req.url?.startsWith("/bundle.js")) {
    res.setHeader("Content-Type", "text/javascript");
    res.end(readFileSync(resolve(dir, "bundle.js")));
  } else if (req.url?.startsWith("/style.css")) {
    res.setHeader("Content-Type", "text/css");
    res.end(readFileSync("src/app/globals.css"));
  } else if (req.url === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  }
});
server.listen(0, "127.0.0.1", () =>
  process.stdout.write(
    JSON.stringify({
      fixture: "I04",
      url: `http://127.0.0.1:${server.address().port}`,
      realProviderCalls: 0,
    }) + "\n",
  ),
);
process.on("SIGINT", () => server.close(() => process.exit(0)));
