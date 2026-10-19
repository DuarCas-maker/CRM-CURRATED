import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { campaignPresets } from "../src/lib/campaign-presets";
import { renderCampaignContent } from "../src/lib/campaign-content";
import {
  campaignTemplateSchema,
  campaignPreviewValues,
} from "../src/lib/campaign-templates";
import { renderTemplate } from "../src/lib/domain";
import { installCampaignPresets } from "../src/lib/server/install-campaign-presets";
import { buildMime } from "../worker/mime";

test("reference templates personalize subjects and tables, retain quoted figures, signature and safe formatting", () => {
  for (const preset of campaignPresets) {
    assert(campaignTemplateSchema.safeParse(preset).success);
    const values = {
      ...campaignPreviewValues,
      name: "Alex <img src=x>",
      company: "Example & Sons | {{name}}",
    };
    const content = renderCampaignContent(
      preset.body,
      values,
      preset.body_format,
    );
    assert.equal((content.html.match(/<table /g) || []).length, 2);
    assert.equal((content.html.match(/colspan="2"/g) || []).length, 2);
    assert(content.html.includes("Example &amp; Sons | {{name}}"));
    assert(content.html.includes("Alex &lt;img src=x&gt;"));
    assert(!content.html.includes("<img"));
    assert(content.html.includes("<strong>Daniel Duarcas</strong>"));
    assert(content.html.includes("<em>Funding Manager</em>"));
    assert(content.html.includes('data-crm-signature="true"'));
    assert(content.html.includes("mailto:daniel@curatedfinancial.com"));
    assert(content.html.includes(values.unsubscribe_url));
    assert(content.text.includes(values.company));
    assert(!content.text.includes(":::table"));
    assert(!content.text.includes(":::signature"));
    assert(renderTemplate(preset.subject, values).includes(values.company));
    assert(!preset.body.includes("{{Last name}}"));
    assert(!preset.body.includes("{{First name}}"));
    const mime = Buffer.from(
      buildMime({
        from: "daniel@curatedfinancial.com",
        to: "recipient@example.test",
        subject: renderTemplate(preset.subject, values),
        body: content.text,
        bodyHtml: content.html,
        messageId: "<reference@example.test>",
      }),
      "base64url",
    ).toString();
    const encodedHtml = mime.match(
      /Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/,
    )?.[1];
    assert(encodedHtml);
    const outgoingHtml = Buffer.from(encodedHtml, "base64").toString();
    assert.equal(
      outgoingHtml,
      content.html ? `<div>${content.html}</div>` : "",
    );
  }
  const offer = renderCampaignContent(
    campaignPresets[0].body,
    campaignPreviewValues,
    "markdown",
  );
  assert(offer.html.includes("background-color:#000000"));
  assert(offer.text.includes("$70,297.72"));
  assert(offer.text.includes("$4,870.91"));
  const approval = renderCampaignContent(
    campaignPresets[1].body,
    campaignPreviewValues,
    "markdown",
  );
  assert(approval.html.includes("background-color:#214784"));
  assert(approval.text.includes("$14,059.54"));
  assert(approval.text.includes("1.25%-2.5%"));
});

test("tables reject malformed structure and unknown styling without allowing HTML or URL injection", () => {
  assert.throws(
    () =>
      renderCampaignContent(
        ":::table red\n| x | y |\n| --- | --- |\n:::",
        {},
        "markdown",
      ),
    /color/,
  );
  assert.throws(
    () =>
      renderCampaignContent(
        ":::table black\n| x | y |\n| --- | --- |\n| a | b |",
        {},
        "markdown",
      ),
    /cerrar/,
  );
  assert.throws(
    () =>
      renderCampaignContent(
        ":::table black\n| x | y |\n| --- | --- |\n| a | b | c |\n:::",
        {},
        "markdown",
      ),
    /filas/,
  );
  assert.throws(
    () =>
      renderCampaignContent(
        "[Email](mailto:a@test.com?bcc=other@test.com)",
        {},
        "markdown",
      ),
    /enlaces/,
  );
  const rendered = renderCampaignContent(
    "| {{company}} | |\n| --- | --- |\n| Name | {{name}} |",
    {
      company: "<script>alert(1)</script>",
      name: "[attack](javascript:alert)",
    },
    "markdown",
  );
  assert(rendered.html.includes("&lt;script&gt;"));
  assert(!rendered.html.includes('href="javascript:'));
});

test("installing the two templates is idempotent and preserves edits and version history", async (t) => {
  const records = new Map<string, Record<string, unknown>>(),
    versions = new Map<string, unknown>();
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
          input instanceof Request ? input : new Request(input, init),
        url = new URL(request.url),
        resource = url.pathname.split("/").at(-1);
      assert.equal(url.hostname, "campaign-presets-fixture.example.test");
      if (resource === "profiles")
        return Response.json({ id: "admin-fixture" });
      if (resource === "email_templates") {
        if (request.method === "GET")
          return Response.json([...records.values()]);
        assert(
          request.headers
            .get("prefer")
            ?.includes("resolution=ignore-duplicates"),
        );
        const inserted = [];
        for (const row of await request.json())
          if (!records.has(row.id)) {
            records.set(row.id, {
              ...row,
              version: 1,
              archived_at: null,
              updated_at: new Date().toISOString(),
            });
            inserted.push({ id: row.id });
          }
        return Response.json(inserted);
      }
      if (resource === "email_template_versions") {
        assert(
          request.headers
            .get("prefer")
            ?.includes("resolution=ignore-duplicates"),
        );
        for (const row of await request.json()) {
          const key = `${row.template_id}:${row.version}`;
          if (!versions.has(key)) versions.set(key, row.snapshot);
        }
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fixture request: ${resource}`);
    },
  );
  const client = createClient(
    "https://campaign-presets-fixture.example.test",
    "fixture-only",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  assert.equal((await installCampaignPresets(client)).created, 2);
  assert.equal(versions.size, 2);
  const first = campaignPresets[0].id,
    original = versions.get(`${first}:1`);
  records.set(first, { ...records.get(first), name: "User edit", version: 2 });
  const replay = await installCampaignPresets(client);
  assert.equal(replay.created, 0);
  assert.equal(replay.available, 2);
  assert.equal(records.get(first)?.name, "User edit");
  assert.deepEqual(versions.get(`${first}:1`), original);
  assert.equal(versions.size, 3);
});
