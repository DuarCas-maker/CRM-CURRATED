// Offline comparison against the exact public source inspected before this task.
// Run from the repository root with --import ./tests/offline.mjs --import tsx.
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { readWorkspace } from "../../../src/lib/server/workspace.ts";
import { loadWorkspaceMail } from "../../../src/lib/server/workspace-mail.ts";
import { demoWorkspace } from "../../../src/lib/demo.ts";

process.env.GMAIL_HISTORY_ENABLED = "false";
const baseline = "a34a089";
const source = (path) => execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" });
const oldWorkspaceUrl = new URL("../../../src/lib/server/performance-baseline.ts", import.meta.url).href;
const oldMailUrl = new URL("../../../src/lib/server/performance-mail-baseline.ts", import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if ([oldWorkspaceUrl, oldMailUrl].includes(specifier)) return { url: specifier, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === oldWorkspaceUrl) return { format: "module-typescript", shortCircuit: true, source: source("src/lib/server/workspace.ts").replace("const { db, profile } = await requireUser();", "const { db, profile } = globalThis.performanceFixture;") };
    if (url === oldMailUrl) return { format: "module-typescript", shortCircuit: true, source: source("src/lib/server/workspace-mail.ts") };
    return next(url, context);
  },
});
const oldWorkspace = (await import(oldWorkspaceUrl)).loadWorkspace;
const oldMail = (await import(oldMailUrl)).loadWorkspaceMail;
hook.deregister();
const seed = demoWorkspace();
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
function fixture(mail) {
  let calls = 0, active = 0, peak = 0;
  const db = createClient("https://performance-fixture.invalid", "fixture", {
    auth: { persistSession: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input)), table = url.pathname.split("/").at(-1);
      calls++; peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 25)); active--;
      let rows = [];
      if (["operational_settings", "notification_preferences"].includes(table)) rows = null;
      if (["opportunity_workspace", "opportunity_tasks"].includes(table)) rows = [{ ...seed.opportunities[0], id: id(1), handed_off_at: null }];
      if (table === "mail_access_context") rows = { area: "seller", can_write: false };
      if (table === "workspace_stats") rows = { total: 1 };
      if (mail) {
        const key = table === "messages" ? "conversation_id" : "message_id";
        rows = url.searchParams.get(key).slice(4, -1).split(",").map((id) => ({ id, conversation_id: id, message_id: id, sent_at: "2026-11-18T12:00:00Z" }));
      }
      return Response.json(rows, { headers: { "Content-Range": "0-0/1" } });
    } },
  });
  return { db, metrics: () => ({ calls, peak }) };
}
const results = [];
for (const kind of ["workspace-tasks", "mail-200", "mail-3000"]) {
  for (const revision of ["before", "after"]) {
    const f = fixture(kind.startsWith("mail")), start = performance.now();
    let data;
    if (kind.startsWith("mail")) data = await (revision === "before" ? oldMail : loadWorkspaceMail)(f.db, Array.from({ length: Number(kind.slice(5)) }, (_, i) => id(i)));
    else if (revision === "before") {
      globalThis.performanceFixture = { db: f.db, profile: seed.profile };
      data = await oldWorkspace(new URLSearchParams({ view: "tasks" }));
      delete globalThis.performanceFixture;
    } else data = await readWorkspace(f.db, seed.profile, new URLSearchParams({ view: "tasks" }));
    results.push({ kind, revision, elapsed_ms: Math.round(performance.now() - start), ...f.metrics(), messages: data.messages.length, ...(data.attachments ? { attachments: data.attachments.length } : {}) });
  }
}
console.log(JSON.stringify({ baseline, latency_ms: 25, synthetic: true, results }, null, 2));
