// Loopback-only fixture, no env loading or external destinations.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const dir = resolve(".local/connect-compat-visual");
mkdirSync(dir, { recursive: true });
await build({
  entryPoints: ["tests/fixtures/pipeline-os-s02-connect-compat-browser.tsx"],
  bundle: true,
  outfile: resolve(dir, "bundle.js"),
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  define: { "process.env.NODE_ENV": '"development"' },
});
if (process.argv.includes("--build-only")) process.exit(0);
const id = "10000000-0000-4000-8000-000000000001";
const childId = "40000000-0000-4000-8000-000000000001";
let recoveryPosts = 0;
const recoveredView = () => ({status:{id:childId,revision:1,state:"awaiting_brand",deadline_ms:Date.now()+600000,
  expected_mailbox_email:"ensayo@example.test",account_id:"20000000-0000-4000-8000-000000000001",
  brand_id:"30000000-0000-4000-8000-000000000001",binding_id:null,cleanup_required:false,composio_enabled:false,next:"review_brand",expired:false},
  pending:{review_id:"50000000-0000-4000-8000-000000000001",expected_revision:1,context_hash:"a".repeat(64)},context_changed:false});
let statusGets = 0,
  deniedMutations = 0;
const html =
  '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect — QA ficticia</title><link rel="stylesheet" href="/style.css"><style>body{padding:16px}main{max-width:1000px;margin:auto}output{display:block;overflow-wrap:anywhere}</style><div id="root"></div><script src="/bundle.js"></script></html>';
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; object-src 'none'",
  );
  const pathname = new URL(req.url, "http://fixture.invalid").pathname;
  if(pathname==="/api/mail/composio/connect/recovery") {
    res.setHeader("Content-Type","application/json");
    if(req.method==="POST") {recoveryPosts++;req.resume();res.end(JSON.stringify(recoveredView()));}
    else if(req.method==="GET")res.end(JSON.stringify({items:[{source_id:id,source_revision:4,email:"ensayo@example.test",created_at:"2026-11-16T14:18:22Z",state:recoveryPosts?"completed":"available",child_id:recoveryPosts?childId:null}]}));
    else res.writeHead(405).end();return;
  }
  if(pathname===`/api/mail/composio/connect/${childId}` && req.method==="GET") {statusGets++;res.setHeader("Content-Type","application/json");res.end(JSON.stringify(recoveredView()));return;}
  if (req.method !== "GET") {
    deniedMutations++;
    res.writeHead(405).end();
    return;
  }
  if (pathname === "/bundle.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(readFileSync(resolve(dir, "bundle.js")));
  } else if (pathname === "/style.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(readFileSync("src/app/globals.css"));
  } else if (pathname === `/api/mail/composio/connect/${id}`) {
    statusGets++;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        status: {
          id,
          revision: 4,
          state: "awaiting_consent",
          deadline_ms: Date.now() + 600000,
          expected_mailbox_email: "ensayo@example.test",
          account_id: "20000000-0000-4000-8000-000000000001",
          brand_id: "30000000-0000-4000-8000-000000000001",
          binding_id: null,
          cleanup_required: true,
          composio_enabled: false,
          next: "resume",
          expired: false,
        },
        pending: null,
        context_changed: false,
      }),
    );
  } else if (pathname === "/__fixture/observations") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ statusGets, recoveryPosts, deniedMutations, externalRequests: 0 }),
    );
  } else if (pathname === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  } else res.writeHead(404).end();
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}/?composio_connect=${id}&connect_error=CONNECT_UNAVAILABLE`,
      fictional: true,
    }),
  ),
);
process.on("SIGINT", () => server.close(() => process.exit(0)));
