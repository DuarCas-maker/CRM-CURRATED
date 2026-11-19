import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { flowFixture } from "./campaign-flow";
import {
  defaultReminders,
  withoutInlineSignature,
} from "../../src/lib/campaign-sequence";
export const sequenceRoot =
  "docs/specs/pipeline-os/campaign-template-sequence-20261119/";
export async function exerciseTemplateSequence(
  f: Awaited<ReturnType<typeof flowFixture>>,
) {
  const { db } = f;
  // Private runtime schema doubles: only identity/revision columns read by this RPC.
  await db.exec(
    "reset role;create schema mail_runtime;create table mail_runtime.routes(account_id uuid primary key,revision bigint,provider text);create schema simple_mail;create table simple_mail.health(account_id uuid primary key)",
  );
  const up = await readFile(sequenceRoot + "up.sql", "utf8"),
    content = await readFile(sequenceRoot + "content.sql", "utf8");
  const body =
    "Hey {{name}}\n\n:::signature\n**A fixed author**\nfixed@example.test\n:::\n\n[Unsubscribe]({{unsubscribe_url}})";
  await db.query(
    "update email_templates set body=$1,body_format='markdown' where id=$2",
    [body, f.template],
  );
  await f.asUser(f.users.admin);
  const existing = await f.launch();
  const campaignBefore = (
    await db.query<any>("select to_jsonb(c) v from campaigns c where id=$1", [
      existing.id,
    ])
  ).rows[0].v;
  await db.exec("reset role");
  await db.query(
    "insert into mail_credentials(account_id,encrypted_refresh_token) values($1,'fictional-not-decrypted') on conflict do nothing",
    [f.accounts[0]],
  );
  await db.exec(up);
  await db.exec(content);
  await db.exec(content);
  const current = (
    await db.query<any>("select * from email_templates where id=$1", [
      f.template,
    ])
  ).rows[0];
  assert.equal(current.version, 2);
  assert.equal(current.body, withoutInlineSignature(body, "markdown"));
  assert.deepEqual(current.steps, defaultReminders);
  assert.deepEqual(
    (
      await db.query<any>("select to_jsonb(c) v from campaigns c where id=$1", [
        existing.id,
      ])
    ).rows[0].v,
    campaignBefore,
  );
  assert.equal(
    (
      await db.query<any>(
        "select snapshot from email_template_versions where template_id=$1 and version=1",
        [f.template],
      )
    ).rows[0].snapshot.body,
    body,
  );
  const scope = async (user = f.users.admin, prep = f.prep) => {
    await f.asUser(user);
    return (
      await db.query<any>("select campaign_signature_scope($1,$2) v", [
        f.accounts[0],
        prep,
      ])
    ).rows[0].v;
  };
  assert.equal((await scope()).revision, 0);
  await assert.rejects(scope(f.users.seller), /CSIG_FORBIDDEN/);
  await assert.rejects(scope(f.users.outsider), /CSIG_FORBIDDEN/);
  await db.exec("reset role");
  await db.query("update profiles set role='seller_admin' where id=$1", [
    f.users.outsider,
  ]);
  await assert.rejects(scope(f.users.outsider), /BRAND_DELIVERY_FORBIDDEN/);
  await assert.rejects(
    scope(f.users.admin, { ...f.prep, account_revision: 999 }),
    /BRAND_PREPARATION_STALE/,
  );
  await f.asUser(f.users.admin, "aal1");
  await assert.rejects(
    db.query("select campaign_signature_scope($1,$2)", [f.accounts[0], f.prep]),
    /CSIG_FORBIDDEN/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(
    db.query("select campaign_signature_scope($1,$2)", [f.accounts[0], f.prep]),
    /permission denied/,
  );
  await db.exec("reset role;set role service_role");
  await assert.rejects(
    db.query("select campaign_signature_scope($1,$2)", [f.accounts[0], f.prep]),
    /permission denied/,
  );
  await db.exec("reset role");
  await db.query("insert into mail_runtime.routes values($1,7,'gmail_oauth')", [
    f.accounts[0],
  ]);
  assert.equal((await scope()).revision, 7);
  await db.exec("reset role");
  await db.query("update email_templates set version=version+1 where id=$1", [
    f.template,
  ]);
  await assert.rejects(
    db.exec(await readFile(sequenceRoot + "down.sql", "utf8")),
    /CSIG_ROLLBACK_STALE/,
  );
  await db.exec("rollback");
  await db.query("update email_templates set version=2 where id=$1", [
    f.template,
  ]);
  await db.exec(await readFile(sequenceRoot + "down.sql", "utf8"));
  const restored = (
    await db.query<any>(
      "select body,steps,version from email_templates where id=$1",
      [f.template],
    )
  ).rows[0];
  assert.equal(restored.body, body);
  assert.deepEqual(restored.steps, []);
  assert.equal(restored.version, 3);
  return {
    passed: true,
    permissions: true,
    mfa: true,
    historyPreserved: true,
    activeCampaignUnchanged: true,
    contentReplay: true,
    staleRollbackDenied: true,
    reversalPassed: true,
    sqlSha256: createHash("sha256").update(up).digest("hex"),
    contentSha256: createHash("sha256").update(content).digest("hex"),
    realProviderRequests: 0,
  };
}
