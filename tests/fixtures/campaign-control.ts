import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {featureDatabase} from '../feature-database';
import {installBrandDelivery,bindFixtureAccount} from './pipeline-os-s02-brand-delivery';
const root='docs/specs/pipeline-os/campaign-control-20261116/migrations/';
export async function controlFixture(factory: typeof featureDatabase = featureDatabase) {
  const f = await factory();
  const { db, users } = f;
  await db.exec(
    await readFile(
      "docs/specs/pipeline-os/campaign-import-flow-20261116/migrations/up.sql",
      "utf8",
    ),
  );
  await installBrandDelivery(f);
  const accounts = [randomUUID(), randomUUID()];
  for (const id of accounts)
    await db.query(
      "insert into mail_accounts(id,email,organization,status,daily_limit,campaign_daily_limit,operational_reserve,external_usage_synced_at) values($1,$2,'Example','connected',350,100,20,now())",
      [id, id + "@example.test"],
    );
  const prep = await bindFixtureAccount(f, accounts[0]);
  const review = await f.command("brand_mapping_propose", {
    account_id: accounts[1],
    proposed_brand_id: prep.brand_id,
    expected_account_revision: 0,
    evidence_reference: "fixture",
  });
  await f.command("brand_mapping_confirm", {
    review_id: review.id,
    expected_review_revision: 1,
    expected_account_revision: 0,
    acknowledge_conflict: true,
  });
  await db.exec(
    "reset role;alter default privileges in schema public grant execute on functions to service_role",
  );
  await db.exec(await readFile(root + "up.sql", "utf8"));
  const template = randomUUID(),
    batch = randomUUID();
  await db.query(
    "insert into email_templates(id,name,subject,body,created_by,updated_by) values($1,'Example','Hi {{company}}','Hello {{name}} {{unsubscribe_url}}',$2,$2)",
    [template, users.admin],
  );
  await db.query(
    "insert into import_batches(id,name,status,total,processed,storage_path,mapping,created_by,request_key) values($1,'Example.xlsx','completed',4,4,'fixture.xlsx','{}',$2,$3)",
    [batch, users.admin, randomUUID()],
  );
  const contacts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    contacts.push(id);
    await db.query(
      "insert into contacts(id,email,name,verification) values($1,$2,'Example contact','valid')",
      [id, id + "@example.test"],
    );
    await db.query(
      "insert into leads(contact_id,company,seller_id) values($1,'Example Business',$2)",
      [id, users.seller],
    );
    await db.query(
      "insert into import_rows(batch_id,row_number,contact_id,result) values($1,$2,$3,'imported')",
      [batch, i + 1, id],
    );
  }
  const payload = {
    import_batch_id: batch,
    name: "Unified example",
    seller_id: users.seller,
    template_id: template,
    template_version: 1,
    daily_limit: 1,
    timezone: "UTC",
    start_hour: 0,
    end_hour: 24,
    subject: "Hi {{company}}",
    body: "Hello {{name}} {{unsubscribe_url}}",
    steps: [],
    body_format: "plain",
    senders: accounts.map((account_id) => ({
      account_id,
      daily_limit: 100,
      brand_preparation: prep,
    })),
  };
  async function read(
    mode = "overview",
    campaign: string | null = null,
    filter = "all",
    page = 0,
  ) {
    await f.asUser(users.admin);
    return (
      await db.query<any>("select campaign_control_read($1,$2,$3,$4,$5,$6) r", [
        mode,
        null,
        campaign,
        filter,
        "",
        page,
      ])
    ).rows[0].r;
  }
  async function command(kind: string, p: object, key = randomUUID()) {
    await f.asUser(users.admin);
    return (
      await db.query<any>("select campaign_control_command($1,$2,$3) r", [
        kind,
        p,
        key,
      ])
    ).rows[0].r;
  }
  return {
    ...f,
    baseCommand:f.command,
    accounts,
    prep,
    template,
    batch,
    contacts,
    payload,
    read,
    command,
  };
}
export async function queueFixture(f:Awaited<ReturnType<typeof controlFixture>>,id:string){
 await f.db.exec('reset role');
 await f.db.exec("update opportunities set email_qualified_at=now()");
 const rows=(await f.db.query<any>("select e.id,e.opportunity_id,c.account_id,c.created_by,ct.email from campaign_enrollments e join campaigns c on c.id=e.campaign_id join contacts ct on ct.id=e.contact_id join campaign_group_members m on m.campaign_id=c.id where m.group_id=$1 and e.status='active'",[id])).rows;
 for(const r of rows)await f.db.query("insert into outbox(account_id,opportunity_id,enrollment_id,to_email,subject,body,area,message_id_header,requested_by,request_key) values($1,$2,$3,$4,'Fixture','Fixture body','seller',$5,$6,$7) on conflict(request_key) do nothing",[r.account_id,r.opportunity_id,r.id,r.email,`<${r.id}.0@crm.curated.local>`,r.created_by,`campaign:${r.id}:0`]);
}
