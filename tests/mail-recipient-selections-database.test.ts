import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("personal recipient selections enforce ownership, active membership and MFA through RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role service_role bypassrls; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user',true),'')::uuid $$;
      create table public.profiles(id uuid primary key,active boolean default true);
      create function public.current_app_role() returns text language sql stable security definer as $$
        select 'seller' from public.profiles where id=auth.uid() and active and current_setting('test.aal',true)='aal2' $$;
      grant usage on schema auth,public to authenticated;
      grant execute on function auth.uid() to authenticated;`);
    await db.exec(
      await readFile(
        "supabase/migrations/040_mail_recipient_selections.sql",
        "utf8",
      ),
    );
    const owner = randomUUID(),
      other = randomUUID(),
      id = randomUUID();
    await db.query("insert into profiles(id) values($1),($2)", [owner, other]);
    async function asUser(user: string, aal = "aal2") {
      await db.exec("reset role");
      await db.query(
        "select set_config('test.user',$1,false),set_config('test.aal',$2,false)",
        [user, aal],
      );
      await db.exec("set role authenticated");
    }
    const targets = JSON.stringify([
      { lender_id: randomUUID(), email: "a@firm.test", cc_emails: [] },
    ]);
    await asUser(owner);
    await db.query(
      "insert into mail_recipient_selections(id,user_id,name,targets) values($1,$2,'Personal',$3)",
      [id, owner, targets],
    );
    assert.equal(
      (await db.query("select * from mail_recipient_selections")).rows.length,
      1,
    );
    await asUser(other);
    assert.equal(
      (await db.query("select * from mail_recipient_selections")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into mail_recipient_selections(user_id,name,targets) values($1,'Forged',$2)",
        [owner, targets],
      ),
      /row-level security/,
    );
    await db.query(
      "update mail_recipient_selections set name='Stolen' where id=$1",
      [id],
    );
    await db.query("delete from mail_recipient_selections where id=$1", [id]);
    await asUser(owner, "aal1");
    assert.equal(
      (await db.query("select * from mail_recipient_selections")).rows.length,
      0,
    );
    await asUser(owner);
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from mail_recipient_selections",
        )
      ).rows[0].name,
      "Personal",
    );
    await assert.rejects(
      db.query("update mail_recipient_selections set user_id=$1 where id=$2", [
        other,
        id,
      ]),
      /row-level security/,
    );
    await db.exec("reset role");
    await db.query("update profiles set active=false where id=$1", [owner]);
    await asUser(owner);
    assert.equal(
      (await db.query("select * from mail_recipient_selections")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into mail_recipient_selections(user_id,name,targets) values($1,'Inactive',$2)",
        [owner, targets],
      ),
      /row-level security/,
    );
  } finally {
    await db.close();
  }
});
