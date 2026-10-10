import { requireUser, HttpError, jsonError } from "@/lib/server/supabase";
import { configuredOrganizations } from "@/lib/server/google";
export async function GET() {
  try {
    const { profile } = await requireUser();
    if (profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    return Response.json(
      {
        organizations: configuredOrganizations().map(({ id, domain }) => ({
          id,
          domain,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
