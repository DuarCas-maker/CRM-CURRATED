import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  checkDb,
  jsonError,
  HttpError,
  serviceClient,
} from "@/lib/server/supabase";
import { renderTemplate } from "@/lib/domain";
import { readBounded } from "@/lib/server/body";
import { mailAction } from "@/lib/server/mail-actions";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
const envelope = z.object({
  kind: z.string().max(50),
  payload: z.record(z.string(), z.unknown()),
  idempotency_key: z.uuid(),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    if (Number(request.headers.get("content-length") || 0) > 100000)
      throw new HttpError(413, "Payload too large");
    const parsed = envelope.safeParse(
      JSON.parse((await readBounded(request, 100000)).toString("utf8")),
    );
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { kind, payload: p, idempotency_key } = parsed.data;
    if (
      ["associate_thread", "import_attachment", "request_documents"].includes(
        kind,
      ) ||
      (["reply", "compose_email"].includes(kind) && gmailHistoryEnabled())
    )
      return Response.json(
        await mailAction(kind, p, idempotency_key, db, profile),
      );
    if (
      kind === "activate_campaign" &&
      process.env.PUBLIC_FORM_ENABLED !== "true"
    )
      throw new HttpError(
        503,
        "Enable the validated public application before activating outreach.",
      );
    if (
      kind === "preferences" &&
      p.email &&
      !process.env.NOTIFICATION_GMAIL_ACCOUNT_ID
    )
      throw new HttpError(
        503,
        "Configure the notification sender account first.",
      );
    if (JSON.stringify(p).length > 100000)
      throw new HttpError(413, "Payload too large");
    if (kind === "create_campaign" || kind === "activate_campaign") {
      const c =
        kind === "activate_campaign"
          ? checkDb(
              await db.from("campaigns").select("*").eq("id", p.id).single(),
            )!
          : p;
      if (!c) throw new HttpError(404, "Campaign not found");
      const templates = [
        c.subject,
        c.body,
        ...(c.steps || []).flatMap((s: { subject: string; body: string }) => [
          s.subject,
          s.body,
        ]),
        c.followup_subject || "",
        c.followup_body || "",
      ];
      try {
        templates.forEach((s) =>
          renderTemplate(String(s), {
            name: "Preview",
            company: "Example",
            application_url: "https://example.com/apply",
            unsubscribe_url: "https://example.com/unsubscribe",
          }),
        );
      } catch {
        throw new HttpError(400, "Unresolved template variables");
      }
    }
    if (kind === "verify_contacts" && !process.env.BOUNCER_API_KEY)
      throw new HttpError(503, "Bouncer is not configured");
    if (kind === "push_subscription") {
      const sub = z
        .object({
          endpoint: z.url(),
          keys: z.object({ p256dh: z.string(), auth: z.string() }),
        })
        .parse(p.subscription);
      const host = new URL(sub.endpoint).hostname;
      if (
        ![
          "fcm.googleapis.com",
          "web.push.apple.com",
          "updates.push.services.mozilla.com",
        ].some((h) => host === h || host.endsWith("." + h)) ||
        new URL(sub.endpoint).protocol !== "https:"
      )
        throw new HttpError(400, "Unsupported push service");
    }
    if (kind === "invite_user") {
      if (profile.role !== "superadmin")
        throw new HttpError(403, "Superadmin required");
      const invite = z
        .object({
          email: z.email(),
          name: z.string().min(1).max(100),
          role: z.enum([
            "superadmin",
            "seller_admin",
            "seller",
            "closer_admin",
            "closer",
          ]),
        })
        .parse(p);
      const service = serviceClient();
      const prior = checkDb(
        await service
          .from("invitations")
          .select("*")
          .eq("email", invite.email.toLowerCase())
          .maybeSingle(),
      );
      if (prior?.sent_at) return Response.json({ ok: true });
      checkDb(
        await service.from("invitations").upsert(
          {
            email: invite.email.toLowerCase(),
            name: invite.name,
            role: invite.role,
            invited_by: profile.id,
          },
          { onConflict: "email" },
        ),
      );
      const result = await service.auth.admin.inviteUserByEmail(
        invite.email.toLowerCase(),
        { redirectTo: `${process.env.APP_ORIGIN}/auth/password` },
      );
      if (result.error)
        throw new HttpError(
          400,
          "Invitation could not be sent. Check Auth configuration.",
        );
      checkDb(
        await service
          .from("invitations")
          .update({ sent_at: new Date().toISOString() })
          .eq("email", invite.email.toLowerCase()),
      );
      checkDb(
        await service.from("audit_log").insert({
          actor_id: profile.id,
          entity_type: "profile",
          entity_id: result.data.user.id,
          action: "invited",
          metadata: { role: invite.role },
        }),
      );
      return Response.json({ ok: true });
    }
    return Response.json(
      checkDb(
        await db.rpc("crm_command", { kind, p, request_key: idempotency_key }),
      ),
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: "Invalid fields" }, { status: 400 });
    return jsonError(e);
  }
}
