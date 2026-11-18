// Synthetic local API and real SQL contracts, no worker and no external requests.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { flowOwnerFixture as flowFixture } from "./fixtures/campaign-flow-owner";
import {
  readControl,
  writeControl,
  controlError,
} from "../src/lib/server/campaign-control";
import { readFlow, launchFlow } from "../src/lib/server/campaign-flow";
const f = await flowFixture();
const { db } = f;
await db.exec("reset role");
for (let i = 0; i < 69; i++) {
  const id = randomUUID();
  await db.query(
    "insert into contacts(id,email,name,verification) values($1,$2,$3,$4)",
    [
      id,
      `lead-${i + 1}@example.test`,
      `Contacto de ejemplo ${i + 1}`,
      i < 55 ? "valid" : i < 65 ? "pending" : "uncertain",
    ],
  );
  await db.query(
    "insert into leads(contact_id,company,seller_id) values($1,$2,$3)",
    [
      id,
      `Negocio de ejemplo ${String(i + 1).padStart(2, "0")}`,
      f.users.seller,
    ],
  );
}
await db.query(
  "update email_templates set subject='Una conversación para {{company}}',body=$1,body_format='markdown' where id=$2",
  [
    "Hola {{name}},\n\nQueremos conocer los planes de **{{company}}** y conversar sobre cómo podemos acompañarte.\n\nPuedes responder a este correo y con gusto coordinamos los siguientes pasos.\n\nGracias por tu tiempo.\n\n[Dejar de recibir correos]({{unsubscribe_url}})",
    f.template,
  ],
);
let chain = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>) => {
  const r = chain.then(fn);
  chain = r.then(
    () => {},
    () => {},
  );
  return r;
};
const signatures: Record<string, string[]> = {
  campaign_control_read: [
    "mode",
    "batch",
    "campaign",
    "filter",
    "search_text",
    "page_number",
  ],
  campaign_control_command: ["kind", "p", "request_key"],
  brand_prepare_context: ["account", "preparation", "purpose", "case_id"],
  campaign_flow_pool: ["search_text", "page_number", "page_size"],
  campaign_flow_launch: ["p", "request_key"],
  campaign_flow_progress: ["campaign"],
};
const ctx: any = {
  profile: { role: "superadmin" },
  db: {
    rpc: async (name: string, args: Record<string, unknown>) =>
      serial(async () => {
        try {
          const names = signatures[name];
          if (!names) throw Error("FIXTURE_RPC_NOT_ALLOWED");
          await f.asUser(f.users.admin);
          return {
            data: (
              await db.query<any>(
                `select public.${name}(${names.map((_, i) => "$" + (i + 1)).join(",")}) r`,
                names.map((k) => args[k] ?? null),
              )
            ).rows[0].r,
            error: null,
          };
        } catch (e: any) {
          return { data: null, error: { message: e.message, code: e.code } };
        }
      }),
  },
};
const req = createRequire(import.meta.url),
  fromTsx = createRequire(req.resolve("tsx"));
const { build } = await import(pathToFileURL(fromTsx.resolve("esbuild")).href);
const built = await build({
  entryPoints: ["tests/fixtures/campaign-flow-browser.tsx"],
  bundle: true,
  platform: "browser",
  format: "esm",
  outdir: ".local/campaign-flow-ui",
  write: false,
  jsx: "automatic",
  external: ["/pipeline-os/*"],
  define: { "process.env.NODE_ENV": '"development"' },
});
const js = built.outputFiles.find((f: any) => f.path.endsWith(".js"))!.contents,
  css = built.outputFiles.find((f: any) => f.path.endsWith(".css"))!.contents;
const counts = { reads: 0, launches: 0, realProviderRequests: 0 };
let failRead = false;
function json(res: http.ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function bytes(req: http.IncomingMessage) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
http
  .createServer(async (req, res) => {
    try {
      const u = new URL(req.url!, "http://127.0.0.1:64832");
      if (u.pathname === "/fixture.js") {
        res.setHeader("Content-Type", "text/javascript");
        return res.end(js);
      }
      if (u.pathname === "/fixture.css") {
        res.setHeader("Content-Type", "text/css");
        return res.end(css);
      }
      if (u.pathname.startsWith("/pipeline-os/fonts/")) {
        const p = path.resolve("public", "." + u.pathname);
        if (!p.startsWith(path.resolve("public") + path.sep))
          throw Error("INVALID_PATH");
        res.setHeader("Content-Type", "font/woff2");
        return res.end(await fs.readFile(p));
      }
      if (u.pathname === "/qa/stats") return json(res, 200, counts);
      if (u.pathname === "/qa/fail-read") {
        failRead = true;
        return json(res, 200, {});
      }
      if (u.pathname === "/qa/workspace") {
        return json(
          res,
          200,
          await serial(async () => {
            await f.asUser(f.users.admin);
            const accounts = (
              await db.query<any>(
                "select id,email,status from mail_accounts order by created_at,id",
              )
            ).rows;
            const caps = (
              await db.query<any>("select brand_sender_capabilities() cap")
            ).rows.map((r) => r.cap);
            return {
              demo: false,
              crm_extensions_ready: true,
              profile: {
                id: f.users.admin,
                name: "Operador de ejemplo",
                role: "superadmin",
              },
              profiles: [
                {
                  id: f.users.seller,
                  name: "Asesor de ejemplo",
                  role: "seller",
                  active: true,
                },
                {
                  id: f.users.admin,
                  name: "Operador de ejemplo",
                  role: "superadmin",
                  active: true,
                },
              ],
              accounts: accounts.map((a) => ({
                ...a,
                brand_context: caps.find((c) => c.account_id === a.id),
              })),
              sender_account_ids: f.accounts,
              imports: (
                await db.query(
                  "select id,name,status,total,processed,imported,duplicates,errors,created_at from import_batches",
                )
              ).rows,
              email_templates: (await db.query("select * from email_templates"))
                .rows,
              campaigns: [],
              campaign_assets: [],
            };
          }),
        );
      }
      if (u.pathname.startsWith("/api/")) {
        try {
          if (failRead && req.method === "GET") {
            failRead = false;
            return json(res, 503, {
              error: "Ensayo: consulta temporalmente no disponible.",
            });
          }
          if (u.pathname === "/api/campaigns/control") {
            if (req.method === "GET") {
              counts.reads++;
              return json(res, 200, await readControl(u, ctx));
            }
            return json(
              res,
              200,
              await writeControl(
                JSON.parse((await bytes(req)).toString()),
                ctx,
              ),
            );
          }
          if (u.pathname === "/api/campaigns/flow") {
            if (req.method === "GET") {
              counts.reads++;
              return json(res, 200, await readFlow(u, ctx));
            }
            counts.launches++;
            return json(
              res,
              200,
              await launchFlow(JSON.parse((await bytes(req)).toString()), ctx),
            );
          }
          return json(res, 501, { error: "Fixture: operation disabled" });
        } catch (e) {
          const r = controlError(e);
          return json(res, r.status, await r.json());
        }
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flujo de campañas · ensayo local</title><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>',
      );
    } catch (e: any) {
      json(res, 500, { error: e.message });
    }
  })
  .listen(64832, "127.0.0.1", () =>
    console.log(
      "LOCAL_CAMPAIGN_FLOW_READY 64832; PGlite fixtures only; no providers",
    ),
  );
