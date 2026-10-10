import { z } from "zod";
import { randomUUID } from "node:crypto";
import { processStates } from "@/lib/financing-history";
import {
  requireUser,
  serviceClient,
  checkOrigin,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
const optionalUuid = z.uuid().nullable();
const command = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create_process"),
    label: z.string().min(1).max(200),
    classification: z.enum(["active", "inactive", "unknown"]),
    started_at: z.iso.datetime(),
    request_key: z.uuid(),
  }),
  z.object({
    operation: z.literal("attach_submission"),
    process_id: z.uuid(),
    submission_id: z.uuid(),
  }),
  z.object({
    operation: z.literal("move_thread"),
    process_id: z.uuid(),
    archive_message_id: z.uuid(),
  }),
  z.object({
    operation: z.literal("transfer"),
    owner_id: z.uuid(),
    account_id: z.uuid(),
  }),
  z.object({
    operation: z.literal("record"),
    process_id: z.uuid(),
    state: z.enum(Object.keys(processStates) as [string, ...string[]]),
    archive_message_id: optionalUuid,
    document_id: optionalUuid,
    body: z.string().min(1).max(10000),
    occurred_at: z.iso.datetime(),
    funded_amount: z.number().positive().nullable(),
    lender_id: optionalUuid,
  }),
  z.object({
    operation: z.literal("select_lender"),
    process_id: z.uuid(),
    submission_id: z.uuid(),
    archive_message_id: z.uuid(),
  }),
  z.object({ operation: z.literal("copy_file"), file_id: z.uuid() }),
  z.object({
    operation: z.literal("review_file"),
    file_id: z.uuid(),
    status: z.enum(["incorporated", "reviewed", "approved"]),
  }),
]);
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = z.uuid().parse((await params).id),
      { db } = await requireUser();
    if (!gmailHistoryEnabled())
      return Response.json({
        processes: [],
        events: [],
        files: [],
        waits: [],
        contacts: [],
      });
    const query = new URL(request.url).searchParams;
    const process = query.get("process");
    if (process) z.uuid().parse(process);
    const page = Math.max(
      0,
      Math.min(100000, Math.floor(Number(query.get("page")) || 0)),
    );
    const opportunity = checkDb(
      await db.from("opportunities").select("*").eq("id", id).single(),
    )!;
    const processes = checkDb(
      await db
        .from("financing_processes")
        .select("*")
        .eq("opportunity_id", id)
        .order("sequence_number"),
    );
    let eventQuery = db
      .from("case_events")
      .select("*")
      .eq("opportunity_id", id)
      .order("occurred_at", { ascending: false })
      .order("id");
    let fileQuery = db
      .from("gmail_saved_attachments")
      .select("*")
      .eq("opportunity_id", id)
      .order("received_at", { ascending: false })
      .order("id");
    if (process) {
      eventQuery = eventQuery.eq("process_id", process);
      fileQuery = fileQuery.eq("process_id", process);
    }
    const events =
      checkDb(await eventQuery.range(page * 100, page * 100 + 100)) || [];
    const files =
      checkDb(await fileQuery.range(page * 100, page * 100 + 100)) || [];
    const waits = checkDb(
      await db.from("mail_waits").select("*").eq("opportunity_id", id),
    );
    const contacts = opportunity.company_id
      ? checkDb(
          await db
            .from("company_contacts")
            .select("relationship,contact_id,contacts(name,email,phone)")
            .eq("company_id", opportunity.company_id),
        )
      : [];
    return Response.json(
      {
        opportunity,
        processes,
        events: events.slice(0, 100),
        files: files.slice(0, 100),
        waits,
        contacts,
        page,
        has_more: events.length > 100 || files.length > 100,
        mail_stats: checkDb(
          await db.rpc("gmail_case_mail_stats", { case_id: id }),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!gmailHistoryEnabled())
      throw new HttpError(503, "Gmail history is not enabled");
    checkOrigin(request);
    const id = z.uuid().parse((await params).id),
      { db, profile } = await requireUser();
    if (!checkDb(await db.rpc("can_edit_case", { case_id: id })))
      throw new HttpError(403, "Case is read-only");
    const input = command.parse(
        JSON.parse((await readBounded(request, 30000)).toString("utf8")),
      ),
      service = serviceClient();
    if (input.operation === "create_process") {
      checkDb(
        await service.rpc("gmail_new_process", {
          case_id: id,
          label_text: input.label,
          classification_value: input.classification,
          started: input.started_at,
          request: input.request_key,
          actor: profile.id,
        }),
      );
    } else if (input.operation === "attach_submission") {
      if (!checkDb(await db.rpc("can_area", { case_id: id, area: "closer" })))
        throw new HttpError(403, "Closer access required");
      checkDb(
        await db
          .from("financing_processes")
          .select("id")
          .eq("id", input.process_id)
          .eq("opportunity_id", id)
          .single(),
      );
      const sub = checkDb(
        await db
          .from("submissions")
          .select("id,process_id")
          .eq("id", input.submission_id)
          .eq("opportunity_id", id)
          .single(),
      )!;
      if (sub.process_id && sub.process_id !== input.process_id)
        throw new HttpError(
          409,
          "Submission already belongs to another process",
        );
      checkDb(
        await service
          .from("submissions")
          .update({ process_id: input.process_id })
          .eq("id", sub.id),
      );
      checkDb(
        await service
          .from("case_events")
          .insert({
            opportunity_id: id,
            process_id: input.process_id,
            submission_id: sub.id,
            area: "closer",
            kind: "submission_association",
            body: "Evaluación relacionada manualmente con este proceso",
            evidence_type: "manual",
            occurred_at: new Date().toISOString(),
            actor_id: profile.id,
          }),
      );
    } else if (input.operation === "transfer") {
      checkDb(
        await service.rpc("gmail_transfer_case", {
          case_id: id,
          owner: input.owner_id,
          account: input.account_id,
          actor: profile.id,
        }),
      );
    } else if (
      input.operation === "copy_file" ||
      input.operation === "review_file"
    ) {
      const file = checkDb(
        await db
          .from("gmail_saved_attachments")
          .select("*")
          .eq("id", input.file_id)
          .eq("opportunity_id", id)
          .single(),
      )!;
      if (input.operation === "copy_file") {
        checkDb(
          await service.from("case_events").insert({
            opportunity_id: id,
            process_id: file.process_id,
            area: file.area,
            kind: "document_copy_requested",
            body: file.name,
            archive_message_id: file.archive_message_id,
            evidence_type: "manual",
            occurred_at: new Date().toISOString(),
            actor_id: profile.id,
          }),
        );
        checkDb(
          await service.from("jobs").insert({
            kind: "gmail_copy_attachment",
            payload: { file_id: file.id },
            dedupe_key: `gmail-file:${file.id}:${randomUUID()}`,
          }),
        );
      } else {
        if (!file.storage_path) throw new HttpError(409, "Copy the file first");
        const previous = [
          "reference",
          "received",
          "incorporated",
          "reviewed",
          "approved",
        ].indexOf(file.status);
        const next = [
          "reference",
          "received",
          "incorporated",
          "reviewed",
          "approved",
        ].indexOf(input.status);
        if (next !== previous + 1)
          throw new HttpError(
            409,
            "Incorporate, review and approve as separate steps",
          );
        checkDb(
          await service
            .from("gmail_saved_attachments")
            .update({
              status: input.status,
              reviewed_by: profile.id,
              reviewed_at: new Date().toISOString(),
            })
            .eq("id", file.id)
            .eq("status", file.status),
        );
        checkDb(
          await service.from("case_events").insert({
            opportunity_id: id,
            process_id: file.process_id,
            area: file.area,
            kind: `document_${input.status}`,
            body: file.name,
            archive_message_id: file.archive_message_id,
            evidence_type: "manual",
            occurred_at: new Date().toISOString(),
            actor_id: profile.id,
          }),
        );
      }
    } else {
      checkDb(
        await db
          .from("financing_processes")
          .select("id")
          .eq("id", input.process_id)
          .eq("opportunity_id", id)
          .single(),
      );
      // Checking the evidence under RLS prevents a seller citing a private closer message by ID.
      if (input.archive_message_id)
        checkDb(
          await db
            .from("case_events")
            .select("id")
            .eq("opportunity_id", id)
            .eq("archive_message_id", input.archive_message_id)
            .limit(1)
            .single(),
        );
      if (input.operation === "move_thread") {
        checkDb(
          await service.rpc("gmail_move_thread", {
            case_id: id,
            evidence: input.archive_message_id,
            process: input.process_id,
            actor: profile.id,
          }),
        );
      } else if (input.operation === "select_lender") {
        if (!checkDb(await db.rpc("can_area", { case_id: id, area: "closer" })))
          throw new HttpError(403, "Closer access required");
        checkDb(
          await service.rpc("gmail_select_lender", {
            process: input.process_id,
            submission: input.submission_id,
            evidence: input.archive_message_id,
            actor: profile.id,
          }),
        );
      } else {
        if (
          [
            "submitted",
            "lender_evaluation",
            "offers",
            "lender_selected",
            "requirements",
            "contract_sent",
            "contract_signed",
            "final_approval",
            "disbursed",
            "funding_declined",
          ].includes(input.state) &&
          !checkDb(await db.rpc("can_area", { case_id: id, area: "closer" }))
        )
          throw new HttpError(403, "Closer access required for lender events");
        if (input.document_id)
          checkDb(
            await db
              .from("documents")
              .select("id")
              .eq("id", input.document_id)
              .eq("opportunity_id", id)
              .single(),
          );
        checkDb(
          await service.rpc("gmail_record_process", {
            process: input.process_id,
            state_value: input.state,
            evidence: input.archive_message_id,
            document: input.document_id,
            body_text: input.body,
            occurred: input.occurred_at,
            actor: profile.id,
            funded_amount: input.funded_amount,
            lender: input.lender_id,
          }),
        );
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: "Invalid fields" }, { status: 400 });
    return jsonError(e);
  }
}
