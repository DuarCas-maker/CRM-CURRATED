import { checkDb, serviceClient } from "./supabase";
import type { TeamLabel } from "../gmail-team";
// Only enrich email identities already authorized through case/message RLS.
// Registry membership grants no login, case, area or mailbox permission.
export async function teamLabels(emails: string[]) {
  const result = new Map<string, TeamLabel>();
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))].filter(
    Boolean,
  );
  for (let i = 0; i < unique.length; i += 100) {
    const rows =
      checkDb(
        await serviceClient()
          .from("gmail_team_members")
          .select("email,team_role,affiliation")
          .in("email", unique.slice(i, i + 100)),
      ) || [];
    for (const row of rows) result.set(row.email, row);
  }
  return result;
}
