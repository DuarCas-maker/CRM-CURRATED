import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { featureDatabase } from "./feature-database";
import { installBrandDelivery } from "./fixtures/pipeline-os-s02-brand-delivery";
import { readPipelineBoard } from "../src/lib/server/pipeline-os-module";
import type { Profile } from "../src/lib/domain";

test("the new catalog queries the real schema under two users' RLS and never widens seller access", async () => {
  const fixture = await featureDatabase();
  const { db, users, asUser } = fixture;
  // Test adapter translates the unchanged REST projections to the actual local PostgreSQL schema.
  const client = {
    async rpc(name: string) {
      assert.equal(name,"campaign_flow_cases");
      // This historical schema fixture has no typed campaign flows.
      return {data:[],error:null};
    },
    from(table: string) {
      const safe = (s: string) => {
        assert(/^[a-z_]+$/.test(s));
        return `"${s}"`;
      };
      let columns = "*",
        order = "id";
      const where: string[] = [];
      const params: unknown[] = [];
      const q = {
        select(s: string) {
          columns = s.split(",").map(safe).join(",");
          return q;
        },
        order(s: string) {
          order = safe(s);
          return q;
        },
        in(key: string, values: string[]) {
          params.push(values);
          where.push(`${safe(key)}=any($${params.length})`);
          return q;
        },
        eq(key: string, value: unknown) {
          params.push(value);
          where.push(`${safe(key)}=$${params.length}`);
          return q;
        },
        is(key: string, value: null) {
          assert.equal(value, null);
          where.push(`${safe(key)} is null`);
          return q;
        },
        async range(start: number, end: number) {
          try {
            const clause = where.length ? ` where ${where.join(" and ")}` : "";
            const count = await db.query<{ n: number }>(
              `select count(*)::int n from ${safe(table)}${clause}`,
              params,
            );
            const r = await db.query(
              `select ${columns} from ${safe(table)}${clause} order by ${order} limit ${Math.min(end - start + 1, 127)} offset ${start}`,
              params,
            );
            return { data: r.rows, count: count.rows[0].n, error: null };
          } catch (e) {
            return {
              data: null,
              count: null,
              error: {
                message: (e as Error).message,
                code: (e as { code?: string }).code,
              },
            };
          }
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  try {
    await installBrandDelivery(fixture);
    const own = randomUUID(),
      other = randomUUID();
    for (const [id, seller] of [
      [own, users.seller],
      [other, users.outsider],
    ]) {
      const contact = randomUUID();
      await db.query(
        "insert into contacts(id,email,verification) values($1,$2,'valid')",
        [contact, `${id}@fiction.test`],
      );
      await db.query(
        "insert into opportunities(id,contact_id,company,seller_id,closer_id,handed_off_at,stage,application_complete,application_signed) values($1,$2,$3,$4,$5,now(),'lenders',true,true)",
        [
          id,
          contact,
          id === own ? "Visible fixture" : "Other fixture",
          seller,
          users.closer,
        ],
      );
    }
    const process = randomUUID();
    await db.query(
      "insert into financing_processes(id,opportunity_id,sequence_number,started_at,classification,label,state) values($1,$2,1,now(),'active','Fixture','contract_signed')",
      [process, own],
    );
    await asUser(users.seller);
    const seller: Profile = {
      id: users.seller,
      name: "Seller",
      email: "seller@fiction.test",
      role: "seller",
    };
    const b = await readPipelineBoard(client, seller);
    assert.equal(b.total, 1);
    assert.equal(b.rows[0].id, own);
    assert.equal(b.rows[0].processState, null);
    assert.equal(b.rows[0].offers, null);
    await asUser(users.closer);
    const closer: Profile = {
      id: users.closer,
      name: "Closer",
      email: "closer@fiction.test",
      role: "closer",
    };
    const c = await readPipelineBoard(client, closer, { group: "signed" });
    assert.equal(c.total, 1);
    assert.equal(c.rows[0].processId, process);
    await asUser(users.outsider);
    const otherBoard = await readPipelineBoard(client, {
      ...seller,
      id: users.outsider,
    });
    assert.equal(otherBoard.total, 1);
    assert.equal(otherBoard.rows[0].id, other);
  } finally {
    await db.close();
  }
});
