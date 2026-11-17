import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutgoingMail } from "../mail-manager";
import {
  lenderTemplateValues,
  renderLenderMessage,
  type LenderReview,
} from "../lender-templates";
import { recipientIssues } from "../mail-recipient-selections";
import { readRecipientDirectory } from "./mail-recipient-selections";
import { checkDb, HttpError } from "./supabase";

// Callers authorize the case, write grant, account and reviewed brand first.
// All merge values come from the authenticated database client, never the browser.
export async function prepareLenderReview(
  db: SupabaseClient,
  input: OutgoingMail,
  signature: { html: string; name: string },
): Promise<LenderReview> {
  const [opportunity, directory] = await Promise.all([
    db
      .from("opportunity_workspace")
      .select("id,company,contact,email,phone,industry,amount,product")
      .eq("id", input.opportunity_id)
      .single()
      .then(checkDb),
    readRecipientDirectory(db),
  ]);
  if (!opportunity)
    throw new HttpError(404, "Expediente no disponible. / Case unavailable.");
  if (recipientIssues(input.targets, directory).length)
    throw new HttpError(
      409,
      "Corrige o quita los lenders sin un contacto válido antes de revisar. / Correct or remove invalid lenders.",
    );
  const messages = input.targets.map((target) => {
    const lender_name = directory.lenders.find(
      (l) => l.id === target.lender_id,
    )!.name;
    const rendered = renderLenderMessage(
      input,
      lenderTemplateValues(opportunity, lender_name),
    );
    if (rendered.missing.length || rendered.error)
      throw new HttpError(
        409,
        rendered.error ||
          `Completa o edita estas variables: ${rendered.missing.join(", ")}.`,
      );
    return {
      ...rendered,
      lender_id: target.lender_id,
      lender_name,
      email: target.email,
      cc_emails: target.cc_emails,
    };
  });
  const { lender_review_digest: _digest, ...reviewedInput } = input;
  const reviewedSignature = { html: signature.html, name: signature.name };
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        input: reviewedInput,
        messages,
        signature: reviewedSignature,
      }),
    )
    .digest("hex");
  return { digest, messages, signature: reviewedSignature };
}
