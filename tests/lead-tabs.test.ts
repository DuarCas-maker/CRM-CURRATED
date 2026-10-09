import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import type { Lead } from "../src/lib/domain";
import { filterLeadTab, getLeadTab, parseLeadTab } from "../src/lib/lead-tabs";

test("invalid and uncertain leads are separated from preparation, including previously converted contacts", () => {
  const cases: [Lead["verification"], string | null, string][] = [
    ["pending", null, "preparing"],
    ["valid", null, "preparing"],
    ["pending", "existing-opportunity", "converted"],
    ["valid", "existing-opportunity", "converted"],
    ["invalid", null, "risk"],
    ["uncertain", null, "risk"],
    ["invalid", "existing-opportunity", "risk"],
    ["uncertain", "existing-opportunity", "risk"],
  ];
  for (const [verification, opportunity_id, tab] of cases)
    assert.equal(getLeadTab({ verification, opportunity_id }), tab);
  assert.equal(parseLeadTab("risk"), "risk");
  assert.equal(parseLeadTab(null), "preparing");
  assert.equal(parseLeadTab("unexpected"), "preparing");
});

test("a reviewed uncertain lead moves out of risk only after a valid result and into converted after promotion", () => {
  const lead: Pick<Lead, "verification" | "opportunity_id"> = {
    verification: "uncertain",
    opportunity_id: null,
  };
  assert.equal(getLeadTab(lead), "risk");
  lead.verification = "valid";
  assert.equal(getLeadTab(lead), "preparing");
  lead.opportunity_id = "verified-opportunity";
  assert.equal(getLeadTab(lead), "converted");
});

test("Supabase requests filter each inbox before pagination while preserving search, owner and exact counts", async () => {
  const requests: { url: URL; headers: Headers }[] = [];
  type TestDatabase = {
    public: {
      Tables: Record<string, never>;
      Views: {
        lead_workspace: {
          Row: Lead;
          Relationships: [];
        };
      };
      Functions: Record<string, never>;
    };
  };
  const client = createClient<TestDatabase>(
    "https://supabase.example.com",
    "test-public-key",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          requests.push({
            url: new URL(input instanceof Request ? input.url : String(input)),
            headers: new Headers(init?.headers),
          });
          return new Response("[]", {
            headers: {
              "Content-Type": "application/json",
              "Content-Range": "*/0",
            },
          });
        },
      },
    },
  );
  for (const tab of ["preparing", "converted", "risk"] as const) {
    const response = await filterLeadTab(
      client.from("lead_workspace").select("*", { count: "exact" }),
      tab,
    )
      .eq("seller_id", "assigned-seller")
      .or("company.ilike.%Test%,contact.ilike.%Test%,email.ilike.%Test%")
      .order("created_at", { ascending: false })
      .range(100, 199);
    assert.equal(response.error, null);
  }
  assert.equal(requests.length, 3);
  const expected = [
    ["in.(pending,valid)", "is.null"],
    ["in.(pending,valid)", "not.is.null"],
    ["in.(invalid,uncertain)", null],
  ];
  for (const [index, { url, headers }] of requests.entries()) {
    assert.equal(url.pathname, "/rest/v1/lead_workspace");
    assert.equal(url.searchParams.get("verification"), expected[index][0]);
    assert.equal(url.searchParams.get("opportunity_id"), expected[index][1]);
    assert.equal(url.searchParams.get("seller_id"), "eq.assigned-seller");
    assert.ok(url.searchParams.get("or")?.includes("company.ilike.%Test%"));
    assert.equal(url.searchParams.get("offset"), "100");
    assert.equal(url.searchParams.get("limit"), "100");
    assert.ok(headers.get("prefer")?.includes("count=exact"));
  }
});
