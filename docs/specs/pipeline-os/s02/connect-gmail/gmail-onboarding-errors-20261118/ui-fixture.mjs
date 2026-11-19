import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.resolve("tsx"));
const { build } = require("esbuild");
const folder =
  "docs/specs/pipeline-os/s02/connect-gmail/gmail-onboarding-errors-20261118/";
const output = path.resolve(".local/legacy-mail-ui");
await fs.mkdir(output, { recursive: true });
await build({
  entryPoints: [folder + "ui-fixture.tsx"],
  bundle: true,
  outfile: output + "/app.js",
  jsx: "automatic",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { "@": path.resolve("src") },
  logLevel: "warning",
});
if (process.argv.includes("--build-only")) process.exit(0);
const files = { "/app.js": "application/javascript", "/app.css": "text/css" };
const server = http.createServer(async (req, res) => {
  if (req.url === "/") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ensayo local Gmail</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
    );
    return;
  }
  if (Object.hasOwn(files, req.url)) {
    res.setHeader("content-type", files[req.url]);
    res.end(await fs.readFile(output + req.url));
    return;
  }
  res.writeHead(404).end();
});
server.listen(3197, "127.0.0.1", () =>
  console.log("Offline UI fixture: http://127.0.0.1:3197"),
);
