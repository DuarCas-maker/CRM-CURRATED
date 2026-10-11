import { z } from "zod";
import { teamIdentitySchema } from "@/lib/gmail-team";
import {
  requireUser,
  checkOrigin,
  checkDb,
  serviceClient,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
async function admin() {
  const user = await requireUser();
  if (!gmailHistoryEnabled())
    throw new HttpError(503, "Gmail history is not enabled");
  if (user.profile.role !== "superadmin")
    throw new HttpError(403, "Superadmin required");
  return user;
}
export async function GET() {
  try {
    const { db } = await admin();
    return Response.json(
      {
        members:
          checkDb(
            await db.from("gmail_team_members").select("*").order("email"),
          ) || [],
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
    const { profile } = await admin();
    const input = teamIdentitySchema.parse(
      JSON.parse((await readBounded(request, 10000)).toString("utf8")),
    );
    checkDb(
      await serviceClient().rpc("gmail_register_team", {
        address: input.email,
        name_text: input.name,
        role_text: input.team_role,
        affiliation_text: input.affiliation,
        profile: input.profile_id,
        actor: profile.id,
      }),
    );
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: "Invalid fields" }, { status: 400 });
    return jsonError(e);
  }
}
