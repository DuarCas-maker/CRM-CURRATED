import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Profile } from "../domain";
import { twoMonthsBefore } from "../gmail-history";
import { serviceClient, checkDb, HttpError } from "./supabase";

const uuid = z.uuid();
export const historyActionSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("start"),
    account_id: uuid,
    request_key: uuid,
  }),
  z.object({
    operation: z.enum(["pause", "resume", "confirm", "undo"]),
    run_id: uuid,
  }),
  z.object({ operation: z.literal("owner"), account_id: uuid, owner_id: uuid }),
  z.object({ operation: z.literal("disconnect"), account_id: uuid }),
  z.object({
    operation: z.literal("team_thread"),
    run_id: uuid,
    candidate_id: uuid,
    evidence_id: uuid,
    opportunity_id: uuid,
    process_id: uuid,
    submission_id: uuid.nullable(),
  }),
  z.object({
    operation: z.literal("select"),
    run_id: uuid,
    candidate_id: uuid,
    selected: z.boolean(),
    name: z.string().max(200),
    company_name: z.string().max(300),
    phone: z.string().max(100),
    classification: z.enum(["active", "inactive", "unknown"]),
    participant_kind: z.enum([
      "client",
      "lender",
      "broker",
      "other",
      "unknown",
    ]),
    selected_opportunity_id: uuid.nullable(),
    selected_process_id: uuid.nullable(),
    selected_company_id: uuid.nullable(),
    submission_id: uuid.nullable(),
  }),
]);
export type HistoryAction = z.infer<typeof historyActionSchema>;
export async function historyAction(input: HistoryAction, actor: Profile) {
  if (actor.role !== "superadmin")
    throw new HttpError(403, "Superadmin required");
  const db = serviceClient();
  if (input.operation === "owner") {
    const owner = checkDb(
      await db
        .from("profiles")
        .select("id,role,active")
        .eq("id", input.owner_id)
        .single(),
    )!;
    if (
      !owner.active ||
      !["seller", "seller_admin", "superadmin"].includes(owner.role)
    )
      throw new HttpError(400, "Assign an active seller");
    checkDb(
      await db
        .from("mail_accounts")
        .update({ owner_id: owner.id })
        .eq("id", input.account_id),
    );
    return { ok: true };
  }
  if (input.operation === "disconnect") {
    checkDb(
      await db
        .from("mail_accounts")
        .update({ status: "disconnected", sync_enabled: false })
        .eq("id", input.account_id),
    );
    checkDb(
      await db
        .from("mail_credentials")
        .delete()
        .eq("account_id", input.account_id),
    );
    checkDb(
      await db
        .from("outbox")
        .update({ status: "paused" })
        .eq("account_id", input.account_id)
        .eq("status", "queued"),
    );
    // Tokens are removed; the archive and copied files are never deleted.
    checkDb(
      await db.from("audit_log").insert({
        actor_id: actor.id,
        entity_type: "mail_account",
        entity_id: input.account_id,
        action: "disconnected",
      }),
    );
    return { ok: true };
  }
  if (input.operation === "start") {
    const prior = checkDb(
      await db
        .from("gmail_runs")
        .select("*")
        .eq("request_key", input.request_key)
        .maybeSingle(),
    );
    if (prior) {
      if (prior.account_id !== input.account_id)
        throw new HttpError(409, "Request key reused");
      return { id: prior.id };
    }
    const account = checkDb(
      await db
        .from("mail_accounts")
        .select("*")
        .eq("id", input.account_id)
        .single(),
    )!;
    if (account.status !== "connected")
      throw new HttpError(409, "Reconnect this account first");
    const now = new Date(),
      from = new Date(now);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    const run = checkDb(
      await db
        .from("gmail_runs")
        .insert({
          account_id: account.id,
          purpose: "historical",
          from_at: from.toISOString(),
          until_at: now.toISOString(),
          copy_since: twoMonthsBefore(now.toISOString()),
          created_by: actor.id,
          request_key: input.request_key,
        })
        .select("id")
        .single(),
    )!;
    checkDb(
      await db.from("jobs").insert({
        kind: "gmail_archive",
        payload: { run_id: run.id },
        dedupe_key: `gmail-archive:${run.id}:start`,
      }),
    );
    return { id: run.id };
  }
  const run = checkDb(
    await db.from("gmail_runs").select("*").eq("id", input.run_id).single(),
  )!;
  if (input.operation === "team_thread") {
    checkDb(
      await db
        .from("gmail_candidates")
        .select("id")
        .eq("id", input.candidate_id)
        .eq("run_id", run.id)
        .single(),
    );
    checkDb(
      await db.rpc("gmail_associate_team_thread", {
        candidate: input.candidate_id,
        evidence: input.evidence_id,
        case_id: input.opportunity_id,
        process: input.process_id,
        submission: input.submission_id,
        actor: actor.id,
      }),
    );
    return { ok: true };
  }
  if (input.operation === "undo")
    return checkDb(
      await db.rpc("gmail_undo_import", { run: run.id, actor: actor.id }),
    );
  if (input.operation === "pause") {
    if (!["analyzing", "importing"].includes(run.status))
      throw new HttpError(409, "This operation is not running");
    checkDb(
      await db
        .from("gmail_runs")
        .update({
          status: "paused",
          resume_status: run.status,
          lease_token: null,
          lease_until: null,
        })
        .eq("id", run.id)
        .eq("status", run.status),
    );
    return { ok: true };
  }
  if (input.operation === "resume") {
    if (!["paused", "failed"].includes(run.status))
      throw new HttpError(409, "This operation cannot be resumed");
    checkDb(
      await db
        .from("gmail_runs")
        .update({
          status:
            run.resume_status ||
            (run.phase === "import" ? "importing" : "analyzing"),
          lease_token: null,
          lease_until: null,
          last_error: null,
          retry_at: null,
          errors: 0,
        })
        .eq("id", run.id)
        .eq("status", run.status),
    );
    checkDb(
      await db.from("jobs").insert({
        kind: "gmail_archive",
        payload: { run_id: run.id },
        dedupe_key: `gmail-archive:${run.id}:${randomUUID()}`,
      }),
    );
    return { ok: true };
  }
  if (
    run.status !== "review" &&
    !(
      input.operation === "select" &&
      run.status === "failed" &&
      run.phase === "import"
    )
  )
    throw new HttpError(
      409,
      "Finish the analysis before selecting or confirming",
    );
  if (input.operation === "select") {
    const { operation: _operation, run_id, candidate_id, ...values } = input;
    const candidate = checkDb(
      await db
        .from("gmail_candidates")
        .select("imported_at,email,participant_kind")
        .eq("id", candidate_id)
        .eq("run_id", run_id)
        .single(),
    )!;
    if (candidate.imported_at)
      throw new HttpError(
        409,
        "This participant has already been imported; review the case timeline instead",
      );
    const team = checkDb(
      await db
        .from("gmail_team_members")
        .select("email")
        .eq("email", candidate.email)
        .maybeSingle(),
    );
    if (team || candidate.participant_kind === "team")
      throw new HttpError(
        409,
        "Equipo: asocia cada conversación por separado. / Team: associate each conversation separately.",
      );
    if (
      values.selected &&
      (values.classification === "unknown" ||
        values.participant_kind === "unknown" ||
        (!values.company_name.trim() &&
          !values.selected_opportunity_id &&
          !values.selected_company_id))
    )
      throw new HttpError(
        400,
        "Confirm the participant, company and active/inactive classification",
      );
    checkDb(
      await db
        .from("gmail_candidates")
        .update(values)
        .eq("id", candidate_id)
        .eq("run_id", run_id),
    );
    return { ok: true };
  }
  const account = checkDb(
    await db
      .from("mail_accounts")
      .select("owner_id,status")
      .eq("id", run.account_id)
      .single(),
  )!;
  if (!account.owner_id || account.status !== "connected")
    throw new HttpError(
      409,
      "Assign the mailbox owner and connect the account first",
    );
  const selected = await db
    .from("gmail_candidates")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id)
    .eq("selected", true);
  checkDb(selected);
  if (!selected.count)
    throw new HttpError(400, "Select at least one reviewed candidate");
  checkDb(
    await db.rpc("gmail_confirm_import", { run: run.id, actor: actor.id }),
  );
  return { ok: true };
}
