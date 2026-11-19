import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = "https://crm.finlabinc.com";
const checks = [];
let loginHtml = "";
for (const path of ["/api/health", "/login", "/api/workspace", "/api/pipeline-os", "/api/pipeline-os/master"]) {
  const started = performance.now();
  const r = await fetch(origin + path, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  const body = await r.text();
  if (path === "/login") loginHtml = body;
  checks.push({ path, status: r.status, duration_ms: Math.round(performance.now()-started), cache_control: r.headers.get("cache-control") });
}
const assets = [...new Set([...loginHtml.matchAll(/<script[^>]+src="([^\"]+)"/g)].map(m=>m[1]))];
let localDates = false;
const scripts = [];
for (const path of assets) {
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/_next/static/")) continue;
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const js = await r.text();
  localDates ||= js.includes('.resolvedOptions().timeZone') && js.includes('"UTC"');
  scripts.push({ path: url.pathname, status: r.status, sha256: createHash('sha256').update(js).digest('hex') });
}
const report = { at: new Date().toISOString(), authenticated: false, checks, local_dates_asset: localDates, scripts };
const output = process.argv[2];
if (output) await writeFile(output, JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ checks, local_dates_asset: localDates, scripts: scripts.length }));
