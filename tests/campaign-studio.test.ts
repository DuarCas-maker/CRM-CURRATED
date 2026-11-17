import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";
import {
  importReviewSchema,
  verificationReason,
} from "../src/lib/campaign-import-review";
import {
  readImportCampaign,
  writeImportCampaign,
  importCampaignError,
  type ImportCampaignContext,
} from "../src/lib/server/campaign-import";
const root = "docs/specs/pipeline-os/campaign-studio-20261116/migrations/";
async function fixture() {
  const f = await featureDatabase();
  const { db, users } = f;
  await db.exec(
    await readFile(
      "docs/specs/pipeline-os/campaign-import-flow-20261116/migrations/up.sql",
      "utf8",
    ),
  );
  await db.exec(
    "alter default privileges in schema public grant execute on functions to service_role",
  );
  const before = (
    await db.query<any>(
      "select oid::regprocedure::text signature,md5(prosrc) source from pg_proc where pronamespace='public'::regnamespace order by oid",
    )
  ).rows;
  await db.exec(await readFile(root + "up.sql", "utf8"));
  async function batch() {
    await db.exec("reset role");
    const id = randomUUID();
    await db.query(
      "insert into import_batches(id,name,status,total,processed,storage_path,mapping,created_by,request_key) values($1,'Example.xlsx','completed',0,0,'fixture.xlsx','{}',$2,$3)",
      [id, users.admin, randomUUID()],
    );
    return id;
  }
  async function contact(
    b: string,
    state = "technical_error",
    verification = "pending",
    reason = "provider_http_402",
  ) {
    await db.exec("reset role");
    const id = randomUUID();
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,$2,'Alex',$3)",
      [id, id + "@example.test", verification],
    );
    await db.query(
      "insert into leads(contact_id,company,seller_id) values($1,'Example Business',$2)",
      [id, users.seller],
    );
    await db.query(
      "insert into import_rows(batch_id,row_number,contact_id,result) select $1,coalesce(max(row_number),0)+1,$2,'imported' from import_rows where batch_id=$1",
      [b, id],
    );
    await db.query(
      "insert into verifications(contact_id,request_key,result,state,reason) values($1,$2,$3,$4,$5)",
      [id, randomUUID(), verification, state, reason],
    );
    return id;
  }
  async function rpc(name: string, args: unknown[]) {
    await f.asUser(users.admin);
    return (
      await db.query<any>(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`,
        args,
      )
    ).rows[0].r;
  }
  return { ...f, batch, contact, rpc, before };
}
test("CS: review scope, unique contacts, reasons, filters and pagination use only the chosen batch", async () => {
  const f = await fixture();
  try {
    const b = await f.batch(),
      other = await f.batch();
    const tech = await f.contact(b),
      unknown = await f.contact(b, "uncertain_request"),
      valid = await f.contact(b, "completed", "valid"),
      uncertain = await f.contact(b, "completed", "uncertain");
    await f.contact(other);
    await f.db.query(
      "insert into import_rows(batch_id,row_number,contact_id,result) values($1,99,$2,'duplicate')",
      [b, tech],
    );
    const review = importReviewSchema.parse(
      await f.rpc("campaign_import_review_page", [b, "", "attention", 0]),
    );
    assert.equal(review.total, 2);
    assert.equal(review.summary.insufficient_credits, 1);
    assert.equal(
      review.rows.find((x) => x.contact_id === tech)?.retryable,
      true,
    );
    assert.equal(
      review.rows.find((x) => x.contact_id === unknown)?.retryable,
      false,
    );
    assert.equal(
      (await f.rpc("campaign_import_review_page", [b, "", "valid", 0])).rows[0]
        .contact_id,
      valid,
    );
    assert.equal(
      (await f.rpc("campaign_import_review_page", [b, "", "uncertain", 0]))
        .rows[0].contact_id,
      uncertain,
    );
    assert.equal(
      (await f.rpc("campaign_import_review_page", [b, "no-match", "all", 0]))
        .total,
      0,
    );
    assert.equal(
      (await f.rpc("campaign_import_review_page", [b, "", "all", 1])).rows
        .length,
      0,
    );
    for (let i = 0; i < 50; i++) await f.contact(b);
    assert.equal(
      (await f.rpc("campaign_import_review_page", [b, "", "technical", 0])).rows
        .length,
      50,
    );
    assert.equal(
      (await f.rpc("campaign_import_review_page", [b, "", "technical", 1])).rows
        .length,
      1,
    );
  } finally {
    await f.db.close();
  }
});
test("CS: retry is atomic, scoped and idempotent; history is retained and no campaign is activated", async () => {
  const f = await fixture();
  try {
    const b = await f.batch(),
      a = await f.contact(b),
      c = await f.contact(b),
      key = randomUUID();
    const queued = await f.rpc("campaign_retry_import", [b, [a, c], 2, key]);
    assert.equal(queued.queued, 2);
    assert.deepEqual(
      await f.rpc("campaign_retry_import", [b, [c, a], 2, key]),
      queued,
    );
    await assert.rejects(
      f.rpc("campaign_retry_import", [b, [a], 1, key]),
      /Idempotency key reused/,
    );
    await assert.rejects(
      f.rpc("campaign_retry_import", [b, [a], 1, randomUUID()]),
      /CI_RETRY_STALE/,
    );
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from verifications"))
        .rows[0].n,
      4,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from jobs where kind='scrub'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from campaigns")).rows[0]
        .n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("CS: forged, stale, suppressed, uncertain and duplicate selections fail with zero partial queue", async () => {
  const f = await fixture();
  try {
    const b = await f.batch(),
      other = await f.batch(),
      good = await f.contact(b),
      outside = await f.contact(other),
      unknown = await f.contact(b, "uncertain_request"),
      suppressed = await f.contact(b),
      valid = await f.contact(b, "completed", "valid");
    await f.db.query(
      "insert into suppressions(email,reason) select email,'test' from contacts where id=$1",
      [suppressed],
    );
    const beforeJobs = (
      await f.db.query<any>("select count(*)::int n from jobs")
    ).rows[0].n;
    for (const bad of [outside, unknown, suppressed, valid, randomUUID()])
      await assert.rejects(
        f.rpc("campaign_retry_import", [b, [good, bad], 2, randomUUID()]),
        /CI_RETRY_STALE/,
      );
    await assert.rejects(
      f.rpc("campaign_retry_import", [b, [good, good], 2, randomUUID()]),
      /CI_INVALID_INPUT/,
    );
    await assert.rejects(
      f.rpc("campaign_retry_import", [b, [], 0, randomUUID()]),
      /CI_INVALID_INPUT/,
    );
    await assert.rejects(
      f.rpc("campaign_retry_import", [b, [good], 2, randomUUID()]),
      /CI_INVALID_INPUT/,
    );
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from jobs")).rows[0].n,
      beforeJobs,
    );
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from command_receipts"))
        .rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("CS: role, MFA, inactive actor, ACL and rollback preserve existing sources and records", async () => {
  const f = await fixture();
  try {
    const b = await f.batch(),
      id = await f.contact(b);
    for (const [actor, aal] of [
      [f.users.seller, "aal2"],
      [f.users.admin, "aal1"],
    ]) {
      await f.asUser(actor, aal);
      await assert.rejects(
        f.db.query("select campaign_import_review_page($1)", [b]),
        /CI_FORBIDDEN/,
      );
      await assert.rejects(
        f.db.query("select campaign_retry_import($1,$2,1,$3)", [
          b,
          [id],
          randomUUID(),
        ]),
        /CI_FORBIDDEN/,
      );
    }
    await f.db.exec("reset role");
    await f.db.query("update profiles set active=false where id=$1", [
      f.users.admin,
    ]);
    await f.asUser(f.users.admin);
    await assert.rejects(
      f.db.query("select campaign_import_review_page($1)", [b]),
      /CI_FORBIDDEN/,
    );
    await f.db.exec("reset role");
    for (const role of ["anon", "service_role"]) {
      for (const sig of [
        "campaign_import_review_page(uuid,text,text,int)",
        "campaign_retry_import(uuid,uuid[],int,uuid)",
      ])
        assert.equal(
          (
            await f.db.query<any>(
              "select has_function_privilege($1,$2,'EXECUTE') ok",
              [role, sig],
            )
          ).rows[0].ok,
          false,
        );
    }
    await f.db.exec(await readFile(root + "down.sql", "utf8"));
    const after = (
      await f.db.query<any>(
        "select oid::regprocedure::text signature,md5(prosrc) source from pg_proc where pronamespace='public'::regnamespace order by oid",
      )
    ).rows;
    assert.deepEqual(after, f.before);
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from verifications"))
        .rows[0].n,
      1,
    );
  } finally {
    await f.db.close();
  }
});

test("CS: a conflicting pending verification rolls back all selected contacts and receipts", async () => {
  const f = await fixture();
  try {
    const b = await f.batch(),
      a = await f.contact(b),
      conflict = await f.contact(b);
    await f.db.query(
      "insert into verifications(contact_id,request_key,result,state,created_at) values($1,$2,'pending','queued',now()-interval '1 day')",
      [conflict, randomUUID()],
    );
    await assert.rejects(
      f.rpc("campaign_retry_import", [b, [a, conflict], 2, randomUUID()]),
      /CI_RETRY_STALE/,
    );
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from verifications where contact_id=$1",
          [a],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await f.db.query<any>("select count(*)::int n from command_receipts"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*)::int n from jobs where kind='scrub'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("CS: HTTP review/retry validates strict envelopes and fails closed without configuration or installed RPC", async () => {
  const calls: any[] = [];
  const ctx = {
    profile: { role: "superadmin" },
    db: {
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        return { data: { queued: 1 }, error: null };
      },
    },
  } as unknown as ImportCampaignContext;
  const batch = randomUUID(),
    id = randomUUID(),
    body = {
      kind: "retry",
      batch,
      contact_ids: [id],
      expected_count: 1,
      request_key: randomUUID(),
    };
  await readImportCampaign(
    new URL(
      `https://crm.example.test/api/campaigns/import?mode=review&batch=${batch}&filter=technical&page=2`,
    ),
    ctx,
  );
  assert.deepEqual(calls.pop(), {
    name: "campaign_import_review_page",
    args: {
      batch,
      review_filter: "technical",
      search_text: "",
      page_number: 2,
    },
  });
  const old = process.env.BOUNCER_API_KEY;
  try {
    delete process.env.BOUNCER_API_KEY;
    await assert.rejects(writeImportCampaign(body, ctx), /not configured/);
    assert.equal(calls.length, 0);
    process.env.BOUNCER_API_KEY = "fixture-key-no-network";
    await writeImportCampaign(body, ctx);
    assert.equal(calls.pop().name, "campaign_retry_import");
    for (const invalid of [
      { ...body, contact_ids: [id, id], expected_count: 2 },
      { ...body, expected_count: 2 },
      { ...body, extra: true },
    ])
      assert.equal(
        importCampaignError(
          await writeImportCampaign(invalid, ctx).catch((e) => e),
        ).status,
        400,
      );
    await assert.rejects(
      writeImportCampaign(body, { ...ctx, profile: { role: "seller" } }),
      /MFA/,
    );
    assert.equal(calls.length, 0);
    const unavailable = {
      ...ctx,
      db: {
        rpc: async () => ({
          data: null,
          error: { code: "PGRST202", message: "missing" },
        }),
      },
    } as unknown as ImportCampaignContext;
    assert.equal(
      importCampaignError(
        await writeImportCampaign(body, unavailable).catch((e) => e),
      ).status,
      503,
    );
  } finally {
    if (old === undefined) delete process.env.BOUNCER_API_KEY;
    else process.env.BOUNCER_API_KEY = old;
  }
});
test("CS: reasons distinguish insufficient credits from uncertain requests without echoing provider payloads", () => {
  assert.match(
    verificationReason(
      {
        state: "technical_error",
        verification: "pending",
        reason_code: "provider_http_402",
      },
      "es",
    ),
    /créditos insuficientes/,
  );
  assert.match(
    verificationReason(
      {
        state: "uncertain_request",
        verification: "pending",
        reason_code: "provider_http_402",
      },
      "es",
    ),
    /conciliación/,
  );
  assert.equal(
    verificationReason(
      {
        state: "technical_error",
        verification: "pending",
        reason_code: "untrusted provider payload",
      },
      "en",
    ),
    "Technical error. Resolve the cause before retrying.",
  );
});
