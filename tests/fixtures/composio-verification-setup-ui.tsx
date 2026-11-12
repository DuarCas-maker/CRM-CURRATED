// Local browser fixture. All fetches are simulated; unknown targets fail closed.
import React from "react";
import { createRoot } from "react-dom/client";
import { ComposioAccountBindingsV2 } from "../../src/components/composio-account-bindings-v2";
const account = "11111111-1111-4111-8111-111111111111",
  binding = "22222222-2222-4222-8222-222222222222";
const params = new URLSearchParams(location.search),
  scenario = params.get("scenario") ?? "policy";
const locale = params.get("lang") === "en" ? "en" : "es";
if (["360", "768", "1280"].includes(params.get("width") ?? "")) {
  document.querySelector("main")!.style.width = params.get("width") + "px";
  document.querySelector("main")!.style.maxWidth = "100%";
}
let ready = scenario !== "policy",
  available = false,
  posts: unknown[] = [];
const setup = () => ({
  account_id: account,
  setup_revision: "a".repeat(64),
  policy: {
    expected_generation: ready ? 1 : 0,
    proposed_generation: 1,
    limits: {
      group_units_per_minute: 4500,
      account_units_per_minute: 4500,
      group_units_per_window: 75000000,
      window_seconds: 86460,
    },
    ready,
    can_publish: !ready,
  },
  candidate_id: binding,
  can_grant: ready && scenario !== "disabled",
  checks_enabled: scenario !== "disabled",
  verification_available: available,
  transport: "gmail_oauth",
  composio_enabled: false,
});
const row = {
  id: binding,
  revision: 1,
  status: "candidate",
  reason: null,
  stale: false,
  created_at: new Date().toISOString(),
  reviewed_at: null,
  external_refs: {
    project: "…ture",
    auth_config: "…ture",
    connection: "…ture",
    user: "…ture",
    quota: "…",
  },
};
window.fetch = async (input, init) => {
  const url = String(input),
    base = `/api/mail/accounts/${account}/composio`;
  if (!url.startsWith(base)) throw Error("FIXTURE_NETWORK_BLOCKED");
  if (!init?.method || init.method === "GET") {
    if (url === base + "/verification-setup") {
      if (scenario === "loading") await new Promise((r) => setTimeout(r, 2000));
      if (scenario === "hidden") return Response.json({}, { status: 404 });
      if (scenario === "unavailable")
        return Response.json({ code: "SETUP_UNAVAILABLE" }, { status: 503 });
      return Response.json(setup());
    }
    if (!url.startsWith(base + "?contract_version=2"))
      throw Error("FIXTURE_QUERY_BLOCKED");
    return Response.json({
      contract_version: 2,
      account: {
        id: account,
        email: "pilot@example.test",
        brand_id: "33333333-3333-4333-8333-333333333333",
        brand_name: "Marca ficticia",
        brand_revision: 1,
        account_revision: 1,
        context_hash: "b".repeat(64),
        ready: true,
      },
      head_revision: 1,
      transport: "gmail_oauth",
      composio_enabled: false,
      verification_available: available,
      can_confirm: false,
      current: row,
      history: [row],
      cursor: null,
      policy: {
        id: "44444444-4444-4444-8444-444444444444",
        generation: 1,
        enabled: ready,
      },
      latest_check: null,
    });
  }
  if (url !== base + "/verification-setup")
    throw Error("FIXTURE_MUTATION_BLOCKED");
  const body = JSON.parse(String(init.body));
  posts.push(body);
  const audit = document.getElementById("audit")!;
  audit.textContent = `POST ficticios: ${posts.length}; llamadas reales: 0`;
  audit.dataset.posts = JSON.stringify(posts);
  await new Promise((r) => setTimeout(r, 500));
  if (scenario === "error" && posts.length === 1)
    return Response.json({ code: "SETUP_UNAVAILABLE" }, { status: 503 });
  if (body.action === "publish_policy") ready = true;
  if (body.action === "grant_budget") available = true;
  return Response.json({
    action: body.action,
    saved: true,
    transport: "gmail_oauth",
    composio_enabled: false,
  });
};
createRoot(document.getElementById("root")!).render(
  <ComposioAccountBindingsV2
    locale={locale}
    allowed
    accounts={[{ id: account, email: "pilot@example.test" }]}
  />,
);
