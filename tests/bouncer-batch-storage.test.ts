import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startScrub, pollScrub } from "../worker/bouncer";

test("Bouncer batch storage uses bounded PostgREST URLs without repeating verification", async (t) => {
  const originalFetch = globalThis.fetch;
  const names = [
    "BOUNCER_API_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.BOUNCER_API_KEY = "fixture-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.fixture.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
  try {
    async function fixture(count: number, providerStatus = 200, failPatch = 0) {
      const contacts = Array.from({ length: count }, (_, i) => ({
        id: randomUUID(),
        email: `lead${i}@example.test`,
      }));
      const states = new Map<string, string>(contacts.map((c) => [c.id, "queued"]));
      const patches: {
        ids: string[];
        values: Record<string, unknown>;
        length: number;
      }[] = [];
      const jobs: Record<string, unknown>[] = [];
      const applied: Record<string, unknown>[] = [];
      let posts = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const json = (value: unknown, status = 200) =>
          new Response(JSON.stringify(value), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        if (url.hostname === "api.usebouncer.com") {
          assert.ok(url.pathname.startsWith("/v1.1/email/verify/batch"));
          if (method === "POST") {
            posts++;
            assert.deepEqual(
              JSON.parse(String(init?.body)),
              contacts.map(({ email }) => ({ email })),
            );
            assert.equal(posts, 1, "never resubmit a reserved batch");
            if (providerStatus === 0)
              throw new Error("fixture connection lost after acceptance");
            return json({ batchId: "fixture-batch" }, providerStatus);
          }
          assert.equal(method, "GET");
          if (url.pathname.endsWith("/download"))
            return json([
              {
                email: " Lead0@Example.test ",
                status: "deliverable",
                reason: "accepted_email",
              },
              {
                email: "lead1@example.test",
                status: "undeliverable",
                reason: "rejected_email",
              },
            ]);
          return json({ status: "completed" });
        }
        assert.equal(
          url.hostname,
          "database.fixture.invalid",
          "all network ports must be fake",
        );
        if (url.pathname.endsWith("/rpc/claim_verifications")) {
          const pending = contacts.filter((c) => states.get(c.id) === "queued");
          pending.forEach((c) => states.set(c.id, "uncertain_request"));
          return json(pending);
        }
        if (url.pathname.endsWith("/verifications") && method === "PATCH") {
          const filter = url.searchParams.get("id")!;
          assert.match(filter, /^in\.\(.+\)$/);
          const ids = filter.slice(4, -1).split(",");
          const values = JSON.parse(String(init?.body));
          patches.push({ ids, values, length: url.href.length });
          if (ids.length > 100)
            return new Response("URI too large", { status: 414 });
          if (patches.length === failPatch)
            return json({ code: "XX000", message: "fixture failure" }, 500);
          ids.forEach((id) => states.set(id, values.state));
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/jobs") && method === "POST") {
          jobs.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 201 });
        }
        if (url.pathname.endsWith("/rpc/apply_verification_results")) {
          applied.push(JSON.parse(String(init?.body)));
          return json(null);
        }
        if (
          method === "GET" &&
          /\/(verifications|profiles)$/.test(url.pathname)
        )
          return json([]);
        throw new Error(`UNEXPECTED_FIXTURE_PORT_${method}_${url.pathname}`);
      };
      return { contacts, states, patches, jobs, applied, posts: () => posts };
    }

    for (const count of [0, 100, 502, 1000])
      await t.test(
        `${count} claims retain one provider batch and at most 100 IDs per update`,
        async () => {
          const f = await fixture(count);
          await startScrub();
          assert.equal(f.posts(), count ? 1 : 0);
          assert.deepEqual(
            f.patches.map((p) => p.ids.length),
            Array.from({ length: Math.ceil(count / 100) }, (_, i) =>
              Math.min(100, count - i * 100),
            ),
          );
          assert.deepEqual(
            f.patches.flatMap((p) => p.ids),
            f.contacts.map((c) => c.id),
          );
          assert.ok(
            f.patches.every(
              (p) =>
                p.length < 4500 &&
                p.values.provider_batch_id === "fixture-batch",
            ),
          );
          assert.ok([...f.states.values()].every((s) => s === "submitted"));
          assert.equal(f.jobs.length, count ? 1 : 0);
          if (count) assert.equal(f.jobs[0].kind, "scrub_poll");
        },
      );

    for (const status of [400, 401, 402, 403, 429])
      await t.test(
        `provider ${status} records the reason in bounded updates`,
        async () => {
          const f = await fixture(502, status);
          await startScrub();
          assert.equal(f.posts(), 1);
          assert.deepEqual(
            f.patches.map((p) => p.ids.length),
            [100, 100, 100, 100, 100, 2],
          );
          assert.ok(
            f.patches.every(
              (p) => p.values.reason === `provider_http_${status}`,
            ),
          );
          assert.ok(
            [...f.states.values()].every((s) => s === "technical_error"),
          );
          assert.equal(f.jobs.length, 0);
        },
      );

    for (const status of [0, 500])
      await t.test(
        `ambiguous result ${status} remains reserved and is never resubmitted`,
        async () => {
          const f = await fixture(502, status);
          await startScrub();
          await startScrub();
          assert.equal(f.posts(), 1);
          assert.equal(f.patches.length, 0);
          assert.equal(f.jobs.length, 0);
          assert.ok(
            [...f.states.values()].every((s) => s === "uncertain_request"),
          );
        },
      );

    await t.test(
      "a partial storage failure stops before polling and never reclaims uncertain contacts",
      async () => {
        const f = await fixture(502, 200, 2);
        await assert.rejects(startScrub(), /DATABASE_OPERATION_FAILED/);
        assert.equal(f.patches.length, 2);
        assert.equal(
          [...f.states.values()].filter((s) => s === "submitted").length,
          100,
        );
        assert.equal(
          [...f.states.values()].filter((s) => s === "uncertain_request")
            .length,
          402,
        );
        assert.equal(f.jobs.length, 0);
        await startScrub();
        assert.equal(f.posts(), 1);
      },
    );

    await t.test(
      "existing batch results are downloaded and applied without a verification POST",
      async () => {
        const f = await fixture(0);
        await pollScrub("fixture-batch");
        assert.equal(f.posts(), 0);
        assert.deepEqual(f.applied, [
          {
            batch: "fixture-batch",
            results: [
              {
                email: "lead0@example.test",
                result: "valid",
                reason: "accepted_email",
              },
              {
                email: "lead1@example.test",
                result: "invalid",
                reason: "rejected_email",
              },
            ],
          },
        ]);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) =>
      previous[i] === undefined
        ? delete process.env[name]
        : (process.env[name] = previous[i]),
    );
  }
});
