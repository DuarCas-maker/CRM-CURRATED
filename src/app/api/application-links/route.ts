import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  checkDb,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { makeApplicationLink } from "@/lib/server/application-links";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    const { opportunity_id } = z
      .object({ opportunity_id: z.uuid() })
      .parse(await request.json());
    if (!checkDb(await db.rpc("can_edit_case", { case_id: opportunity_id })))
      throw new HttpError(403, "Access denied");
    return Response.json({
      url: await makeApplicationLink(opportunity_id, profile.id),
    });
  } catch (e) {
    return jsonError(e);
  }
}
