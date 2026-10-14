import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDb, HttpError, serviceClient } from "./supabase";

export async function initializeDocumentChecklist(
  db: SupabaseClient,
  opportunityId: string,
  actorId: string,
  privilegedClient: () => SupabaseClient = serviceClient,
) {
  if (!checkDb(await db.rpc("can_edit_case", { case_id: opportunityId })))
    throw new HttpError(
      403,
      "La oportunidad es de solo lectura. / Case is read-only.",
    );
  const opportunity = checkDb(
    await db
      .from("opportunities")
      .select("id,product")
      .eq("id", opportunityId)
      .maybeSingle(),
  );
  if (!opportunity) throw new HttpError(404, "Opportunity not found");
  const existing =
    checkDb(
      await db
        .from("documents")
        .select("id")
        .eq("opportunity_id", opportunityId)
        .limit(1),
    ) || [];
  if (!existing.length) {
    const service = privilegedClient();
    checkDb(
      await service.rpc("initialize_checklist", {
        case_id: opportunityId,
        product_name: opportunity.product,
      }),
    );
    checkDb(
      await service
        .from("audit_log")
        .insert({
          actor_id: actorId,
          entity_type: "opportunity",
          entity_id: opportunityId,
          action: "document_checklist_initialized",
          metadata: { source: "document_review" },
        }),
    );
  }
  return { opportunity_id: opportunityId };
}
