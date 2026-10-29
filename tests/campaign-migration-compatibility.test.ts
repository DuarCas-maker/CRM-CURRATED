import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { featureDatabase } from "./feature-database";

test("043 preserves legacy sequences and idempotent receipts while new campaigns become first-contact only", async () => {
  const { db, users, asUser, command } = await featureDatabase({
    beforeMigration: "043",
  });
  try {
    const account = randomUUID();
    await db.query(
      "insert into mail_accounts(id,email,organization,status,daily_limit,timezone) values($1,'sender@migration.fixture.test','Fixture','connected',100,'UTC')",
      [account],
    );
    await asUser(users.admin);
    const input = {
      name: "Historical sequence fixture",
      account_id: account,
      seller_id: users.seller,
      daily_limit: 25,
      timezone: "UTC",
      start_hour: 0,
      end_hour: 24,
      subject: "Initial",
      body: "Hi {{name}} {{unsubscribe_url}}",
      steps: [
        {
          subject: "First followup",
          body: "Hi {{name}} {{unsubscribe_url}}",
          wait_days: 2,
        },
        {
          subject: "Second followup",
          body: "Hi {{company}} {{unsubscribe_url}}",
          wait_days: 5,
        },
      ],
    };
    const legacyRequest = randomUUID();
    const legacy = await command("create_campaign", input, legacyRequest);
    const before = (
      await db.query<{ id: string; steps: unknown[]; status: string }>(
        "select id,steps,status from campaigns where id=$1",
        [legacy.id],
      )
    ).rows[0];
    assert.deepEqual(before.steps, input.steps);

    await db.exec("reset role");
    const remaining = (await readdir("supabase/migrations"))
      .filter((file) => file.endsWith(".sql") && file >= "043")
      .sort();
    for (const file of remaining) {
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    }
    await asUser(users.admin);
    const read = async (id: string) =>
      (
        await db.query<{
          id: string;
          steps: unknown[];
          status: string;
          first_contact: boolean;
        }>("select id,steps,status,first_contact from campaigns where id=$1", [
          id,
        ])
      ).rows[0];
    assert.deepEqual(await read(legacy.id), {
      ...before,
      first_contact: false,
    });
    assert.equal(
      (await command("create_campaign", input, legacyRequest)).id,
      legacy.id,
    );
    assert.deepEqual(await read(legacy.id), {
      ...before,
      first_contact: false,
    });

    const currentInput = {
      ...input,
      name: "Current first contact fixture",
      selected_contact_ids: [],
    };
    const currentRequest = randomUUID();
    const current = await command(
      "create_campaign",
      currentInput,
      currentRequest,
    );
    assert.deepEqual(await read(current.id), {
      id: current.id,
      steps: [],
      status: "draft",
      first_contact: true,
    });
    assert.equal(
      (await command("create_campaign", currentInput, currentRequest)).id,
      current.id,
    );
    assert.equal((await db.query("select id from campaigns")).rows.length, 2);
    await assert.rejects(
      command("create_campaign", {
        ...currentInput,
        steps: [
          {
            subject: "Invalid followup",
            body: "Missing unsubscribe",
            wait_days: 2,
          },
        ],
      }),
      /Each follow-up/,
    );

    await asUser(users.seller);
    await assert.rejects(
      command("create_campaign", currentInput),
      /Campaign administrator/,
    );
    await asUser(users.admin, "aal1");
    await assert.rejects(command("create_campaign", currentInput), /MFA/);
    await db.exec("reset role");
    await assert.rejects(
      db.query("update campaigns set steps=$1 where id=$2", [
        JSON.stringify(input.steps),
        current.id,
      ]),
      /first_contact_single_message/,
    );
    assert.deepEqual(await read(legacy.id), {
      ...before,
      first_contact: false,
    });
  } finally {
    await db.close();
  }
});
