import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import type { HistoryCandidate } from "../src/components/gmail-history";
import {
  candidateSearchPattern,
  defaultCandidateFilters,
  filterGmailCandidates,
  parseCandidateFilters,
} from "../src/lib/gmail-candidate-filters";

test("candidate filters validate supported states and keep exact email punctuation", () => {
  assert.deepEqual(
    parseCandidateFilters(new URLSearchParams()),
    defaultCandidateFilters,
  );
  assert.equal(
    parseCandidateFilters(
      new URLSearchParams({ q: "  valentina@curatedfinancial.com  " }),
    ).q,
    "valentina@curatedfinancial.com",
  );
  for (const param of ["kind", "classification", "import_state", "match"])
    assert.throws(() =>
      parseCandidateFilters(new URLSearchParams({ [param]: "invalid" })),
    );
  assert.throws(() =>
    parseCandidateFilters(new URLSearchParams({ q: "a".repeat(201) })),
  );
});

test("database requests combine search and filters before pagination, retaining the run and exact filtered count", async () => {
  const requests: URL[] = [];
  type TestDatabase={public:{Tables:Record<string,never>;Views:{gmail_candidates:{Row:HistoryCandidate&{run_id:string};Relationships:[]}};Functions:Record<string,never>}};
  const client = createClient<TestDatabase>("https://fixture.supabase.test", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        requests.push(url);
        const headers = new Headers(init?.headers);
        assert.match(headers.get("prefer") || "", /count=exact/);
        return new Response("[]", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": "0-0/128",
          },
        });
      },
    },
  });
  const filters = {
    ...defaultCandidateFilters,
    q: "RUDRA SG (Holdings), LLC",
    kind: "client" as const,
    classification: "active" as const,
    import_state: "pending" as const,
    match: "existing" as const,
  };
  const r = await filterGmailCandidates(
    client
      .from("gmail_candidates")
      .select("*", { count: "exact" })
      .eq("run_id", "run-1"),
    filters,
  )
    .order("last_at", { ascending: false })
    .order("id")
    .range(50, 99);
  assert.equal(r.count, 128);
  const p = requests[0].searchParams;
  assert.equal(p.get("run_id"), "eq.run-1");
  assert.equal(p.get("participant_kind"), "eq.client");
  assert.equal(p.get("classification"), "eq.active");
  assert.equal(p.get("imported_at"), "is.null");
  assert.equal(p.get("import_requested_at"), "is.null");
  assert.equal(p.get("existing_contact_id"), "not.is.null");
  assert.equal(p.get("offset"), "50");
  assert.equal(p.get("limit"), "50");
  assert.equal(
    p.get("or"),
    '(name.ilike."%RUDRA SG (Holdings), LLC%",email.ilike."%RUDRA SG (Holdings), LLC%",company_name.ilike."%RUDRA SG (Holdings), LLC%")',
  );
  const bad = 'x",selected.eq.true),name.ilike.("';
  await filterGmailCandidates(
    client.from("gmail_candidates").select("*", { count: "exact" }),
    { ...defaultCandidateFilters, q: bad },
  );
  assert.ok(
    requests[1].searchParams
      .get("or")
      ?.includes('x\\",selected.eq.true),name.ilike.(\\"'),
  );
});

test("pending, selected, queued and imported are separate; combined email search treats SQL wildcards literally", async () => {
  class Query {
    calls: unknown[][] = [];
    eq(c: string, v: string | boolean) {
      this.calls.push(["eq", c, v]);
      return this;
    }
    is(c: string, v: null) {
      this.calls.push(["is", c, v]);
      return this;
    }
    not(c: string, o: string, v: null) {
      this.calls.push(["not", c, o, v]);
      return this;
    }
    or(f: string) {
      this.calls.push(["or", f]);
      return this;
    }
  }
  for (const [state, expected] of [
    [
      "pending",
      [
        ["is", "imported_at", null],
        ["is", "import_requested_at", null],
      ],
    ],
    [
      "selected",
      [
        ["is", "imported_at", null],
        ["is", "import_requested_at", null],
        ["eq", "selected", true],
      ],
    ],
    [
      "queued",
      [
        ["is", "imported_at", null],
        ["not", "import_requested_at", "is", null],
      ],
    ],
    ["imported", [["not", "imported_at", "is", null]]],
    ["errors", [["not", "last_error", "is", null]]],
  ] as const) {
    assert.deepEqual(
      filterGmailCandidates(new Query(), {
        ...defaultCandidateFilters,
        import_state: state,
      }).calls,
      expected,
    );
  }
  const db = new PGlite();
  try {
    const matches = async (value: string, q: string) =>
      (
        await db.query<{ match: boolean }>(
          "select $1::text ilike $2::text as match",
          [value, candidateSearchPattern(q)],
        )
      ).rows[0].match;
    assert.equal(
      await matches(
        "VALENTINA@CURATEDFINANCIAL.COM",
        "valentina@curatedfinancial.com",
      ),
      true,
    );
    assert.equal(await matches("client_a@example.com", "client_"), true);
    assert.equal(await matches("clientXa@example.com", "client_"), false);
    assert.equal(await matches("Company 100% LLC", "100%"), true);
    assert.equal(await matches("Company 1000 LLC", "100%"), false);
    assert.equal(await matches("Client A\\B", "A\\B"), true);
  } finally {
    await db.close();
  }
});
