import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import { demoWorkspace } from "../src/lib/demo";
import { demoAction } from "../src/lib/demo-actions";
import { lenderDirectorySchema } from "../src/lib/lender-directory";

const input = {
  name: "Test lender creation",
  email: "first@lender-creation.test",
  channel: "email",
  products: "MCA, Business loan",
  notes: "Preserve company notes",
};

test("adding a lender persists its company and primary contact, retries once, and rejects conflicts atomically", async () => {
  const { db, users, asUser, command } = await featureDatabase();
  try {
    const payload = lenderDirectorySchema.parse(input);
    await asUser(users.seller);
    await assert.rejects(
      command("create_lender", payload),
      /administrator required/,
    );
    await asUser(users.admin, "aal1");
    await assert.rejects(command("create_lender", payload), /MFA/);
    await asUser(users.admin);
    const key = randomUUID();
    const result = await command("create_lender", payload, key);
    assert.deepEqual(await command("create_lender", payload, key), result);
    const companies = await db.query<{ id: string; products: string[] }>(
      "select * from lenders where name=$1 and archived_at is null",
      [input.name],
    );
    assert.equal(companies.rows.length, 1);
    const company = companies.rows[0];
    assert.deepEqual(company.products, ["MCA", "Business loan"]);
    assert.equal(
      (
        await db.query<{ lender_id: string }>(
          "select lender_id from lender_contacts where email=$1",
          [input.email],
        )
      ).rows[0].lender_id,
      company.id,
    );
    await db.query(
      "select register_named_lender_contact($1,$2,'Second contact')",
      [company.id, "second@lender-creation.test"],
    );
    assert.equal(
      (
        await db.query("select * from lender_contacts where lender_id=$1", [
          company.id,
        ])
      ).rows.length,
      2,
    );
    await assert.rejects(
      command("create_lender", {
        ...payload,
        name: "Rejected duplicate address",
      }),
      /already belongs/,
    );
    assert.equal(
      (
        await db.query(
          "select * from lenders where name='Rejected duplicate address'",
        )
      ).rows.length,
      0,
    );
    const portal = lenderDirectorySchema.parse({
      name: "Test portal creation",
      channel: "portal",
      portal_url: "https://portal.lender-creation.test",
    });
    await command("create_lender", portal);
    assert.equal(
      (
        await db.query("select * from lenders where name=$1 and email=''", [
          portal.name,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from lender_contacts where email='' ")).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("demo lender creation uses the directory validations and registers the primary contact", () => {
  const data = demoWorkspace();
  const saved = demoAction(data, data.profile, "create_lender", {
    ...input,
    email: " FIRST@LENDER-CREATION.TEST ",
  });
  const company = saved.lenders.find((lender) => lender.name === input.name)!;
  assert.equal(saved.lenders.length, data.lenders.length + 1);
  assert.equal(company.email, input.email);
  assert.equal(
    saved.lender_contacts?.find((contact) => contact.email === input.email)
      ?.lender_id,
    company.id,
  );
  assert.throws(() =>
    demoAction(data, data.profile, "create_lender", {
      ...input,
      email: "internal@curatedfinancial.com",
    }),
  );
  assert.throws(() =>
    demoAction(data, data.profile, "create_lender", {
      ...input,
      channel: "portal",
      email: "",
      portal_url: "http://unsafe.test",
    }),
  );
  assert.throws(
    () =>
      demoAction(saved, saved.profile, "create_lender", {
        ...input,
        name: "Rejected duplicate address",
      }),
    /already belongs|pertenece/,
  );
  assert.equal(data.lenders.length + 1, saved.lenders.length);
  assert.equal(
    data.lenders.some((lender) => lender.name === input.name),
    false,
  );
  const portal = demoAction(data, data.profile, "create_lender", {
    name: "Portal without email",
    channel: "portal",
    portal_url: "https://portal.lender-creation.test",
  });
  const portalCompany = portal.lenders.find(
    (lender) => lender.name === "Portal without email",
  )!;
  assert.equal(portalCompany.email, "");
  assert.equal(
    portal.lender_contacts?.some(
      (contact) => contact.lender_id === portalCompany.id,
    ) || false,
    false,
  );
  assert.match(
    portalCompany.notes,
    /Portal: https:\/\/portal\.lender-creation\.test/,
  );
  for (const role of ["seller", "closer"] as const)
    assert.throws(
      () => demoAction(data, { ...data.profile, role }, "create_lender", input),
      /Access denied/,
    );
});
