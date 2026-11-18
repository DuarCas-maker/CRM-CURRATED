import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { scheduleCampaigns } from "../worker/campaigns";
import { encrypt } from "../src/lib/server/crypto";
test("CF worker: typed follow-ups reuse the initial Gmail thread; historical sequences keep their behavior", async (t) => {
  const names = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "INTEGRATION_ENCRYPTION_KEY",
      "APP_ORIGIN",
    ],
    previous = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://campaign-worker.fixture.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
    APP_ORIGIN: "https://crm.example.test",
  });
  const enrollment = {
      id: randomUUID(),
      campaign_id: randomUUID(),
      contact_id: randomUUID(),
      opportunity_id: randomUUID(),
      step: 1,
    },
    account = randomUUID();
  let typed = true;
  const writes: any[] = [];
  let initialReads = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      assert.equal(
        u.hostname,
        "campaign-worker.fixture.test",
        "No Gmail or Bouncer call is allowed",
      );
      const resource = u.pathname.split("/").at(-1);
      let result: any = null;
      if (resource === "complete_finished_campaigns") result = null;
      else if (resource === "due_campaign_enrollments") result = [enrollment];
      else if (resource === "brand_campaign_ready") result = true;
      else if (resource === "campaigns")
        result = {
          id: enrollment.campaign_id,
          status: "active",
          requires_application: false,
          account_id: account,
          created_by: randomUUID(),
          body_format: "plain",
          asset_snapshot: [],
          steps: [
            {
              subject: "Hola {{name}}",
              body: "Seguimiento {{company}} {{unsubscribe_url}}",
              wait_days: 2,
              ...(typed ? { flow_version: 1 } : {}),
            },
          ],
        };
      else if (resource === "contacts")
        result = {
          id: enrollment.contact_id,
          verification: "valid",
          email: "client@example.test",
          name: "Alex",
          phone: "",
        };
      else if (resource === "opportunities")
        result = {
          id: enrollment.opportunity_id,
          stage: "contacting",
          company: "Example",
          industry: "Retail",
          amount: 1,
        };
      else if (resource === "unsubscribe_links")
        result = { encrypted_token: encrypt("fixture-unsubscribe") };
      else if (resource === "outbox" && init?.method === "POST") {
        writes.push(JSON.parse(String(init.body)));
        result = null;
      } else if (
        resource === "outbox" &&
        u.searchParams.get("request_key") === `eq.campaign:${enrollment.id}:0`
      ) {
        initialReads++;
        result = {
          conversation_id: "fixture-conversation",
          gmail_thread_id: "fixture-thread",
        };
      } else if (resource === "outbox") result = null;
      else throw Error("UNEXPECTED_FIXTURE_RESOURCE:" + resource);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  try {
    await scheduleCampaigns();
    typed = false;
    await scheduleCampaigns();
    assert.equal(writes.length, 2);
    assert.equal(initialReads, 1);
    assert.equal(writes[0].conversation_id, "fixture-conversation");
    assert.equal(writes[0].gmail_thread_id, "fixture-thread");
    assert.equal(writes[1].conversation_id, undefined);
    assert.equal(writes[0].request_key, `campaign:${enrollment.id}:1`);
  } finally {
    for (const k of names) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
});
