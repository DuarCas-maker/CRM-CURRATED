import { z } from "zod";
import {
  requireUser,
  serviceClient,
  checkDb,
  checkOrigin,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { senderSignature, sendManagedMail } from "@/lib/server/mail-manager";

export async function GET(request: Request) {
  try {
    const { db, profile } = await requireUser();
    const params = new URL(request.url).searchParams;
    if (params.get("signature"))
      return Response.json(
        await senderSignature(db, z.uuid().parse(params.get("signature"))),
      );
    const service = serviceClient();
    const caseId = params.get("case")
      ? z.uuid().parse(params.get("case"))
      : null;
    if (caseId && !checkDb(await db.rpc("can_mail_case", { case_id: caseId })))
      throw new HttpError(403, "Case access required");
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(params.get("review_page") || 0);
    const pending = checkDb(
      await db.rpc("mail_pending_threads", { page_number: page }),
    );
    let drafts = db
      .from("mail_drafts")
      .select("*")
      .eq("user_id", profile.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (params.get("case"))
      drafts = drafts.eq("opportunity_id", z.uuid().parse(params.get("case")));
    const accounts =
      checkDb(
        await db
          .from("mail_accounts")
          .select("id,email,status,owner_id,live_enabled"),
      ) || [];
    const permissions =
      checkDb(
        await db
          .from("mail_permissions")
          .select("account_id")
          .eq("user_id", profile.id)
          .eq("can_send", true),
      ) || [];
    const related = caseId
      ? checkDb(
          await db
            .from("conversations")
            .select("account_id")
            .eq("opportunity_id", caseId),
        ) || []
      : [];
    const ids = accounts
      .filter(
        (a) =>
          profile.role === "superadmin" ||
          a.owner_id === profile.id ||
          related.some((c) => c.account_id === a.id) ||
          permissions.some((p) => p.account_id === a.id),
      )
      .map((a) => a.id);
    const cursors = ids.length
      ? checkDb(
          await service
            .from("mail_credentials")
            .select("account_id,last_reconciled_at")
            .in("account_id", ids),
        ) || []
      : [];
    const jobs = ids.length
      ? checkDb(
          await service
            .from("jobs")
            .select("status,last_error,created_at,payload")
            .eq("kind", "gmail_sync")
            .order("created_at", { ascending: false })
            .limit(100),
        ) || []
      : [];
    return Response.json(
      {
        pending: pending.threads,
        pending_total: pending.total,
        drafts: checkDb(await drafts) || [],
        accounts: accounts
          .filter((a) => ids.includes(a.id))
          .map((a) => ({
            ...a,
            last_synced_at:
              cursors.find((c) => c.account_id === a.id)?.last_reconciled_at ||
              null,
            job: jobs.find((j) => j.payload.account_id === a.id),
          })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    const envelope = z
      .object({
        action: z.enum(["send", "draft", "associate", "sync", "contact"]),
        request_id: z.uuid(),
        payload: z.record(z.string(), z.unknown()),
      })
      .parse(JSON.parse((await readBounded(request, 300000)).toString("utf8")));
    const p = envelope.payload;
    if (envelope.action === "contact") {
      const c = z
        .object({
          opportunity_id: z.uuid(),
          email: z.email(),
          name: z.string().max(150),
          lender_id: z.uuid().nullable().optional(),
        })
        .parse(p);
      checkDb(
        await db.rpc("register_mail_contact", {
          case_id: c.opportunity_id,
          address: c.email,
          display_name: c.name,
          lender: c.lender_id || null,
        }),
      );
      return Response.json({ ok: true });
    }
    if (envelope.action === "draft") {
      const caseId = z.uuid().parse(p.opportunity_id);
      if (!checkDb(await db.rpc("can_mail_case", { case_id: caseId })))
        throw new HttpError(403, "Case access required");
      checkDb(
        await db.from("mail_drafts").upsert(
          {
            id: envelope.request_id,
            user_id: profile.id,
            opportunity_id: caseId,
            payload: p,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        ),
      );
      return Response.json({ ok: true, id: envelope.request_id });
    }
    if (envelope.action === "associate") {
      const input = z
        .object({
          review_id: z.uuid(),
          opportunity_id: z.uuid(),
          process_id: z.uuid().nullable(),
          submission_id: z.uuid().nullable().optional(),
        })
        .parse(p);
      checkDb(
        await db.rpc("associate_live_mail", {
          review: input.review_id,
          case_id: input.opportunity_id,
          process: input.process_id,
          submission: input.submission_id || null,
        }),
      );
      return Response.json({ ok: true });
    }
    if (envelope.action === "sync") {
      const ids = z.array(z.uuid()).min(1).max(100).parse(p.account_ids);
      const caseId = p.opportunity_id ? z.uuid().parse(p.opportunity_id) : null;
      if (
        caseId &&
        !checkDb(await db.rpc("can_mail_case", { case_id: caseId }))
      )
        throw new HttpError(403, "Case access required");
      for (const id of ids) {
        const permission = checkDb(await db.rpc("can_send", { account: id }));
        const account = checkDb(
          await db
            .from("mail_accounts")
            .select("id,status,owner_id")
            .eq("id", id)
            .single(),
        )!;
        const related = caseId
          ? checkDb(
              await db
                .from("conversations")
                .select("id")
                .eq("opportunity_id", caseId)
                .eq("account_id", id)
                .limit(1),
            ) || []
          : [];
        if (!permission && account.owner_id !== profile.id && !related.length)
          throw new HttpError(403, "Mailbox access required");
        if (account.status !== "connected")
          throw new HttpError(409, "Connect the mailbox");
      }
      const service = serviceClient();
      // Deduplicate repeated clicks; the UI displays queued/running/completed jobs.
      for (const id of ids) {
        const pending =
          checkDb(
            await service
              .from("jobs")
              .select("id")
              .eq("kind", "gmail_sync")
              .contains("payload", { account_id: id })
              .in("status", ["queued", "running"])
              .limit(1),
          ) || [];
        if (!pending.length)
          checkDb(
            await service.from("jobs").upsert(
              {
                kind: "gmail_sync",
                payload: { account_id: id },
                dedupe_key: `manual-sync:${id}:${envelope.request_id}`,
              },
              { onConflict: "dedupe_key", ignoreDuplicates: true },
            ),
          );
      }
      if (caseId) {
        const threads =
          checkDb(
            await db
              .from("conversations")
              .select("account_id,gmail_thread_id")
              .eq("opportunity_id", caseId),
          ) || [];
        for (const thread of threads.filter((t) =>
          ids.includes(t.account_id),
        )) {
          const pending =
            checkDb(
              await service
                .from("jobs")
                .select("id")
                .eq("kind", "gmail_live_thread")
                .contains("payload", {
                  account_id: thread.account_id,
                  thread_id: thread.gmail_thread_id,
                })
                .in("status", ["queued", "running"])
                .limit(1),
            ) || [];
          if (!pending.length)
            checkDb(
              await service
                .from("jobs")
                .upsert(
                  {
                    kind: "gmail_live_thread",
                    payload: {
                      account_id: thread.account_id,
                      thread_id: thread.gmail_thread_id,
                    },
                    dedupe_key: `manual-thread:${thread.account_id}:${thread.gmail_thread_id}:${envelope.request_id}`,
                  },
                  { onConflict: "dedupe_key", ignoreDuplicates: true },
                ),
            );
        }
      }
      return Response.json({ ok: true, queued: true });
    }
    return Response.json(
      await sendManagedMail(db, profile, p, envelope.request_id),
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        {
          error:
            "Revisa destinatarios, asunto y adjuntos. / Check recipients, subject and attachments.",
        },
        { status: 400 },
      );
    return jsonError(e);
  }
}
