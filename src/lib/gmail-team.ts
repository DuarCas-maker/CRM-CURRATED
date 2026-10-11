import { z } from "zod";
export const teamIdentitySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  name: z.string().max(200),
  team_role: z.enum(["seller", "closer"]),
  affiliation: z.enum(["internal", "external"]),
  profile_id: z.uuid().nullable(),
});
export type TeamIdentity = z.infer<typeof teamIdentitySchema>;
export type TeamLabel = Pick<TeamIdentity, "team_role" | "affiliation">;
export function teamLabel(member: TeamLabel, locale: "es" | "en") {
  return `${locale === "es" ? "Equipo" : "Team"} · ${member.team_role === "seller" ? "Seller" : "Closer"} · ${member.affiliation === "external" ? (locale === "es" ? "Colaborador externo" : "External collaborator") : locale === "es" ? "Interno" : "Internal"}`;
}
