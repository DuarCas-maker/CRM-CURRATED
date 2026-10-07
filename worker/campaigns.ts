import { db, checked, alertAdmins } from "./db";
import { renderTemplate } from "../src/lib/domain";
import { token, hash, encrypt, decrypt } from "../src/lib/server/crypto";
export async function scheduleCampaigns() {
  if (
    process.env.PUBLIC_FORM_ENABLED !== "true" ||
    !process.env.FORM_DECLARATION_VERSION ||
    !process.env.FORM_DECLARATION_TEXT
  )
    return;
  const client = db();
  const due =
    checked(
      await client
        .from("campaign_enrollments")
        .select("*")
        .eq("status", "active")
        .lte("next_at", new Date().toISOString())
        .order("next_at")
        .limit(100),
    ) || [];
  for (const enrollment of due) {
    const campaign = checked(
      await client
        .from("campaigns")
        .select("*")
        .eq("id", enrollment.campaign_id)
        .single(),
    )!;
    if (campaign.status !== "active") continue;
    const contact = checked(
      await client
        .from("contacts")
        .select("*")
        .eq("id", enrollment.contact_id)
        .single(),
    )!;
    if (contact.verification !== "valid") continue;
    const opportunity = checked(
      await client
        .from("opportunities")
        .select("*")
        .eq("id", enrollment.opportunity_id)
        .single(),
    )!;
    if (opportunity.handed_off_at || opportunity.application_complete) continue;
    const message =
      enrollment.step === 0 ? campaign : campaign.steps[enrollment.step - 1];
    if (!message) continue;
    const key = `campaign:${enrollment.id}:${enrollment.step}`;
    if (
      checked(
        await client
          .from("outbox")
          .select("id")
          .eq("request_key", key)
          .maybeSingle(),
      )
    )
      continue;
    let application = checked(
      await client
        .from("application_links")
        .select("encrypted_token")
        .eq("opportunity_id", opportunity.id)
        .is("revoked_at", null)
        .gt("expires_at", new Date(Date.now() + 86400000).toISOString())
        .limit(1)
        .maybeSingle(),
    );
    if (!application) {
      const value = token();
      application = { encrypted_token: encrypt(value) };
      checked(
        await client.from("application_links").insert({
          opportunity_id: opportunity.id,
          created_by: campaign.created_by,
          encrypted_token: application.encrypted_token,
          token_hash: hash(value),
          expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
        }),
      );
    }
    let unsubscribe = checked(
      await client
        .from("unsubscribe_links")
        .select("encrypted_token")
        .eq("contact_id", contact.id)
        .maybeSingle(),
    );
    if (!unsubscribe) {
      const value = token();
      checked(
        await client.from("unsubscribe_links").upsert(
          {
            contact_id: contact.id,
            token_hash: hash(value),
            encrypted_token: encrypt(value),
          },
          { onConflict: "contact_id", ignoreDuplicates: true },
        ),
      );
      unsubscribe = checked(
        await client
          .from("unsubscribe_links")
          .select("encrypted_token")
          .eq("contact_id", contact.id)
          .single(),
      )!;
    }
    try {
      const values = {
        name: contact.name,
        company: opportunity.company,
        application_url: `${process.env.APP_ORIGIN}/apply/${decrypt(application.encrypted_token)}`,
        unsubscribe_url: `${process.env.APP_ORIGIN}/unsubscribe/${decrypt(unsubscribe.encrypted_token)}`,
      };
      const subject = renderTemplate(message.subject, values);
      const body = renderTemplate(message.body, values);
      checked(
        await client.from("outbox").upsert(
          {
            account_id: campaign.account_id,
            opportunity_id: opportunity.id,
            enrollment_id: enrollment.id,
            to_email: contact.email,
            subject,
            body,
            area: "seller",
            message_id_header: `<${enrollment.id}.${enrollment.step}@crm.curated.local>`,
            requested_by: campaign.created_by,
            request_key: key,
          },
          { onConflict: "request_key", ignoreDuplicates: true },
        ),
      );
    } catch {
      checked(
        await client
          .from("campaign_enrollments")
          .update({ status: "paused" })
          .eq("id", enrollment.id),
      );
      await alertAdmins(
        `template:${enrollment.id}`,
        "A campaign contact has unresolved template variables",
      );
    }
  }
}
