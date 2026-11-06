import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { featureDatabase } from "./feature-database";

test("B1 local SQL: administration, revisions, reviewed mappings and privileges", async (t) => {
  const f = await featureDatabase(),
    { db, users, asUser } = f;
  const root = "docs/specs/pipeline-os/s02/integration/";
  await db.exec("set pipeline_os.block_a_local='in_memory_test'");
  for (const file of [
    "a-brand-foundation.local.sql",
    "a-mail-permissions.local.sql",
  ])
    await db.exec(await readFile(root + "migrations/" + file, "utf8"));
  const bSql = await readFile(
    root + "block-b/migrations/b-brand-management.local.sql",
    "utf8",
  );
  const owner = () => db.exec("reset role");
  const protectedCatalog = async () =>
    (
      await db.query(
        `select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'instantly_webhook_%' order by signature`,
      )
    ).rows;
  const beforeCatalog = await protectedCatalog();
  async function cmd(kind: string, p: object, key = randomUUID()) {
    return (
      await db.query<{ v: Record<string, unknown> }>(
        "select crm_command($1,$2,$3) v",
        [kind, p, key],
      )
    ).rows[0].v;
  }
  async function page(
    collection: string,
    cursor: string | null = null,
    size = 25,
  ) {
    return (
      await db.query<{
        v: { items: Record<string, unknown>[]; next_cursor: string | null };
      }>("select brand_management_page($1,$2,$3) v", [collection, cursor, size])
    ).rows[0].v;
  }
  const create = async (code: string, active = true) => {
    await asUser(users.admin);
    return String((await cmd("brand_create", { code, name: code, active })).id);
  };
  async function account() {
    await owner();
    const id = randomUUID();
    await db.query<Record<string, unknown>>(
      "insert into mail_accounts(id,email,organization) values($1,$2,'fixture')",
      [id, `${id}@b1.test`],
    );
    return id;
  }
  async function propose(id: string, brand: string | null, extra: object = {}) {
    await asUser(users.admin);
    return cmd("brand_mapping_propose", {
      account_id: id,
      proposed_brand_id: brand,
      expected_account_revision: 0,
      evidence_reference: "fixture-ref",
      ...extra,
    });
  }
  async function confirm(review: Record<string, unknown>, extra: object = {}) {
    await asUser(users.admin);
    return cmd("brand_mapping_confirm", {
      review_id: review.id,
      expected_review_revision: review.revision,
      expected_account_revision: review.account_revision,
      ...extra,
    });
  }
  try {
    await t.test(
      "explicit marker required; rejected candidate rolls back",
      async () => {
        await assert.rejects(db.exec(bSql), /explicit in-memory marker/);
        await db.exec("rollback");
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select to_regnamespace('brand_b1') n",
            )
          ).rows[0].n,
          null,
        );
      },
    );
    await db.exec("set pipeline_os.block_b1_local='in_memory_test'");
    await db.exec(bSql);
    const brand = await create("B1"),
      other = await create("B2");
    await t.test(
      "five roles, AAL1, inactive and anonymous cannot administer; SA AAL2 can",
      async () => {
        for (const role of [
          "seller_admin",
          "seller",
          "closer_admin",
          "closer",
        ]) {
          await owner();
          await db.query<Record<string, unknown>>(
            "update profiles set role=$1 where id=$2",
            [role, users.outsider],
          );
          await asUser(users.outsider);
          await assert.rejects(
            cmd("brand_create", { code: "DENIED", name: "Denied" }),
            /BRAND_FORBIDDEN/,
          );
        }
        await asUser(users.admin, "aal1");
        await assert.rejects(
          cmd("brand_set_status", {
            brand_id: brand,
            active: false,
            expected_revision: 1,
          }),
          /BRAND_FORBIDDEN/,
        );
        await owner();
        await db.query<Record<string, unknown>>(
          "update profiles set active=false where id=$1",
          [users.admin],
        );
        await asUser(users.admin);
        await assert.rejects(
          cmd("brand_create", { code: "DENIED", name: "Denied" }),
          /BRAND_FORBIDDEN/,
        );
        await owner();
        await db.query<Record<string, unknown>>(
          "update profiles set active=true where id=$1",
          [users.admin],
        );
        await db.exec("set role anon");
        await assert.rejects(page("brands"), /permission denied/);
      },
    );
    await t.test(
      "canonical idempotency, CAS and authorization before replay",
      async () => {
        await asUser(users.admin);
        const key = randomUUID(),
          p = { brand_id: brand, name: "Renamed", expected_revision: 1 };
        const first = await cmd("brand_update", p, key);
        assert.equal(first.revision, 2);
        assert.equal((await cmd("brand_update", p, key)).replayed, true);
        await assert.rejects(
          cmd("brand_update", { ...p, name: "Other" }, key),
          /BRAND_KEY_REUSED/,
        );
        await assert.rejects(
          cmd("brand_set_status", {
            brand_id: brand,
            active: false,
            expected_revision: 1,
          }),
          /BRAND_STALE_REVISION/,
        );
        await assert.rejects(
          cmd("brand_update", { ...p, code: "CHANGED" }),
          /BRAND_INVALID_INPUT/,
        );
        await owner();
        await db.query<Record<string, unknown>>(
          "update profiles set active=false where id=$1",
          [users.admin],
        );
        await asUser(users.admin);
        await assert.rejects(cmd("brand_update", p, key), /BRAND_FORBIDDEN/);
        await owner();
        await db.query<Record<string, unknown>>(
          "update profiles set active=true where id=$1",
          [users.admin],
        );
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select code from operating_brands where id=$1",
              [brand],
            )
          ).rows[0].code,
          "B1",
        );
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select count(*) n from command_receipts where request_key=$1",
              [key],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "explicit multi-brand membership, revoke/reactivate increments, no role/sender grants",
      async () => {
        await asUser(users.admin);
        const p = {
          brand_id: brand,
          user_id: users.seller,
          active: true,
          expected_revision: 0,
        };
        assert.equal((await cmd("brand_membership_set", p)).revision, 1);
        await cmd("brand_membership_set", { ...p, brand_id: other });
        assert.equal(
          (
            await cmd("brand_membership_set", {
              ...p,
              active: false,
              expected_revision: 1,
            })
          ).revision,
          2,
        );
        assert.equal(
          (await cmd("brand_membership_set", { ...p, expected_revision: 2 }))
            .revision,
          3,
        );
        await assert.rejects(
          cmd("brand_membership_set", p),
          /BRAND_STALE_REVISION/,
        );
        await owner();
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select role from profiles where id=$1",
              [users.seller],
            )
          ).rows[0].role,
          "seller",
        );
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select count(*) n from mail_permissions where user_id=$1",
              [users.seller],
            )
          ).rows[0].n,
          0,
        );
        await asUser(users.seller);
        assert.equal((await page("brands")).items.length, 2);
        assert.equal((await page("memberships")).items.length, 2);
        await assert.rejects(page("reviews"), /BRAND_FORBIDDEN/);
        await asUser(users.closer);
        assert.equal((await page("brands")).items.length, 0);
        assert.equal((await page("memberships")).items.length, 0);
      },
    );
    await t.test(
      "mapping needs evidence; brand change invalidates proposal; re-review then confirm immutable",
      async () => {
        const id = await account();
        let r = await propose(id, brand, { evidence_reference: null });
        await assert.rejects(confirm(r), /BRAND_REVIEW_REQUIRED/);
        r = await propose(id, brand, {
          review_id: r.id,
          expected_review_revision: r.revision,
        });
        await cmd("brand_set_status", {
          brand_id: brand,
          active: false,
          expected_revision: 2,
        });
        await assert.rejects(confirm(r), /BRAND_REVIEW_STALE/);
        r = await propose(id, brand, {
          review_id: r.id,
          expected_review_revision: r.revision,
        });
        const saved = await confirm(r);
        assert.equal(saved.account_revision, 1);
        await assert.rejects(confirm(r), /BRAND_REVIEW_STALE/);
        await owner();
        const a = (
          await db.query<Record<string, unknown>>(
            "select operating_brand_id,brand_revision from mail_accounts where id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(a.operating_brand_id, brand);
        assert.equal(a.brand_revision, 1);
        await assert.rejects(
          db.query<Record<string, unknown>>(
            "update mail_account_brand_reviews set evidence_reference='changed' where id=$1",
            [r.id],
          ),
          /immutable|confirmed/i,
        );
      },
    );
    await t.test(
      "reassignment conflict requires explicit acknowledgement; account ID and pending work unchanged",
      async () => {
        const id = await account();
        const initial = await propose(id, other);
        await confirm(initial);
        const review = await propose(id, brand, {
          expected_account_revision: 1,
        });
        assert.equal(review.status, "conflict");
        await assert.rejects(confirm(review), /BRAND_CONFLICT_ACK_REQUIRED/);
        assert.equal(
          (await confirm(review, { acknowledge_conflict: true }))
            .account_revision,
          2,
        );
        await owner();
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select count(*) n from outbox",
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select count(*) n from campaigns",
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select count(*) n from mail_credentials",
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "new pending work makes impact stale, requiring a refreshed proposal",
      async () => {
        const id = await account(),
          r = await propose(id, other);
        await owner();
        const contact = randomUUID(),
          caseId = randomUUID();
        await db.query<Record<string, unknown>>(
          "insert into contacts(id,email,name,verification) values($1,'lead@fixture.test','Fixture','valid')",
          [contact],
        );
        await db.query<Record<string, unknown>>(
          "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fixture',$3)",
          [caseId, contact, users.admin],
        );
        await db.query<Record<string, unknown>>(
          "insert into outbox(account_id,opportunity_id,requested_by,to_email,subject,body,area,message_id_header,request_key,signature_html) values($1,$2,$3,'lead@fixture.test','Test','Test','seller','<fixture@b1.test>',$4,'')",
          [id, caseId, users.admin, randomUUID()],
        );
        await assert.rejects(confirm(r), /BRAND_REVIEW_STALE/);
        const updated = await propose(id, other, {
          review_id: r.id,
          expected_review_revision: r.revision,
        });
        assert.equal(updated.status, "conflict");
        await cmd("brand_mapping_discard", {
          review_id: r.id,
          expected_review_revision: updated.revision,
          reason: "admin_discarded",
        });
        await owner();
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select operating_brand_id from mail_accounts where id=$1",
              [id],
            )
          ).rows[0].operating_brand_id,
          null,
        );
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select status from outbox where account_id=$1",
              [id],
            )
          ).rows[0].status,
          "queued",
        );
      },
    );
    await t.test(
      "history interval validated; invalid mutation has no receipt or partial review",
      async () => {
        const id = await account();
        await assert.rejects(
          propose(id, brand, {
            history_approved: true,
            history_from: "2026-02-01T00:00:00Z",
            history_to: "2026-01-01T00:00:00Z",
          }),
          /BRAND_INVALID_INPUT/,
        );
        await assert.rejects(
          propose(id, brand, { history_approved: true }),
          /BRAND_INVALID_INPUT/,
        );
        await owner();
        assert.equal(
          (
            await db.query<Record<string, unknown>>(
              "select count(*) n from mail_account_brand_reviews where account_id=$1",
              [id],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "bounded pagination reaches 200 brands; composite memberships cursor loses no rows",
      async () => {
        await owner();
        await db.query<Record<string, unknown>>(
          "insert into operating_brands(code,name,created_by,updated_by) select 'PAGE_'||i,'Page '||i,$1,$1 from generate_series(1,198) i",
          [users.admin],
        );
        await asUser(users.admin);
        const seen = new Set<string>();
        let cursor: string | null = null;
        do {
          const p = await page("brands", cursor, 25);
          for (const r of p.items) {
            assert.ok(!seen.has(String(r.id)));
            seen.add(String(r.id));
          }
          cursor = p.next_cursor;
        } while (cursor);
        assert.equal(seen.size, 200);
        const p1 = await page("memberships", null, 1),
          p2 = await page("memberships", p1.next_cursor, 1);
        assert.equal(p1.items.length, 1);
        assert.equal(p2.items.length, 1);
        assert.notEqual(p1.items[0].key, p2.items[0].key);
        await assert.rejects(page("brands", null, 101), /BRAND_INVALID_INPUT/);
      },
    );
    await t.test(
      "human/service business DML denied; service technical update preserved; helpers and alias private",
      async () => {
        await asUser(users.admin);
        await assert.rejects(
          db.exec("update operating_brands set active=true"),
          /permission denied/,
        );
        await owner();
        await db.exec("set role service_role");
        await assert.rejects(
          db.exec("update mail_accounts set operating_brand_id=null"),
          /permission denied/,
        );
        await assert.rejects(
          db.exec("delete from operating_brand_memberships"),
          /permission denied/,
        );
        await db.exec("update mail_accounts set status='connected'");
        await assert.rejects(
          db.exec("select brand_b1.admin_actor()"),
          /permission denied/,
        );
        await assert.rejects(
          db.query<Record<string, unknown>>(
            "select crm_command_before_brand_b1($1,$2,$3)",
            ["brand_create", {}, randomUUID()],
          ),
          /permission denied/,
        );
        await owner();
        const bad = (
          await db.query<Record<string, unknown>>(
            "select proname from pg_proc join pg_namespace n on n.oid=pronamespace where (n.nspname='brand_b1' or proname like 'brand_%') and proconfig is distinct from array['search_path=\"\"']::text[]",
          )
        ).rows;
        assert.deepEqual(bad, []);
      },
    );
    await t.test(
      "046/047 RPC definitions and ACL unchanged; legacy CRM wrapper still delegates",
      async () => {
        await owner();
        assert.deepEqual(await protectedCatalog(), beforeCatalog);
        await asUser(users.admin);
        await assert.rejects(
          cmd("fixture_unknown_legacy", {}),
          /Unsupported command/,
        );
        await owner();
        await db.exec("set role service_role");
        await assert.rejects(
          cmd("fixture_unknown_legacy", {}),
          /Unsupported command/,
        );
      },
    );
    await t.test(
      "direct OAuth begin rejects malformed payload without state writes",
      async () => {
        await asUser(users.admin);
        for (const intent of [
          {},
          { mode: "invalid" },
          {
            mode: "new",
            brand_id: other,
            expected_brand_revision: 1,
            actor_id: users.admin,
          },
        ])
          await assert.rejects(
            db.query("select brand_oauth_begin($1,$2,$3)", [
              "a".repeat(64),
              "fixture",
              intent,
            ]),
            /BRAND_INVALID_INPUT/,
          );
        await owner();
        assert.equal(
          (await db.query<{ n: number }>("select count(*) n from oauth_states"))
            .rows[0].n,
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});
