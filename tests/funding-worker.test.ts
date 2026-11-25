import test from "node:test";
import assert from "node:assert/strict";
import { scheduleCampaigns } from "../worker/campaigns";
import { encrypt } from "../src/lib/server/crypto";
import { fundingPreset } from "../src/lib/campaign-presets";
test("worker renders only the frozen income and actual sender; missing snapshot pauses without queuing", async (t) => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://funding-worker.fixture.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    APP_ORIGIN: "https://crm.example.test",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, env);
  let snapshot: number | null = 100000;
  const writes: any[] = [];
  let paused = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      assert.equal(
        u.hostname,
        "funding-worker.fixture.test",
        "No external provider requests",
      );
      const resource = u.pathname.split("/").at(-1);
      let r: any = null;
      if (resource === "complete_finished_campaigns") r = null;
      else if (resource === "due_campaign_enrollments")
        r = [
          {
            id: "enrollment",
            campaign_id: "campaign",
            contact_id: "contact",
            opportunity_id: "opportunity",
            step: 0,
          },
        ];
      else if (resource === "brand_campaign_ready") r = true;
      else if (resource === "campaigns")
        r = {
          ...fundingPreset,
          status: "active",
          requires_application: false,
          id: "campaign",
          account_id: "sender",
          created_by: "admin",
        };
      else if (resource === "contacts")
        r = {
          id: "contact",
          verification: "valid",
          name: "Alex",
          email: "lead@example.test",
          phone: "",
          monthly_income: 999999,
        };
      else if (resource === "opportunities")
        r = {
          id: "opportunity",
          stage: "contacting",
          company: "Example Business",
          amount: 1,
          industry: "Retail",
        };
      else if (resource === "unsubscribe_links")
        r = { encrypted_token: encrypt("fixture-token") };
      else if (
        resource === "campaign_enrollments" &&
        init?.method === "PATCH"
      ) {
        paused++;
        r = null;
      } else if (resource === "campaign_enrollments")
        r = { funding_income_snapshot: snapshot };
      else if (resource === "mail_accounts")
        r = { email: "selected@example.test" };
      else if (resource === "outbox" && init?.method === "POST") {
        writes.push(JSON.parse(String(init.body)));
        r = null;
      } else if (resource === "outbox") r = null;
      else if (resource === "profiles") r = [];
      else throw Error("UNEXPECTED_RESOURCE:" + resource);
      return new Response(JSON.stringify(r), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  try {
    await scheduleCampaigns();
    assert.equal(writes.length, 1);
    assert.match(writes[0].subject, /\$200,000.00/);
    assert.match(writes[0].body_html, /\$6,923.08/);
    assert.match(writes[0].body_html, /mailto:selected@example.test/);
    assert.doesNotMatch(writes[0].body_html, /999,999|\{\{/);
    snapshot = null;
    await scheduleCampaigns();
    assert.equal(writes.length, 1);
    assert.equal(paused, 1);
  } finally {
    for (const k of Object.keys(env)) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
});
