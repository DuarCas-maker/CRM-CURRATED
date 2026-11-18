import { z } from "zod";
import type { Profile } from "./domain";

const instant = z.iso.datetime({ offset: true });
export const connectionAccountSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  organization: z.string(),
  status: z.string(),
  registered_at: instant.nullable(),
  brand: z.string().nullable(),
  association: z.enum([
    "none",
    "candidate",
    "verified",
    "blocked",
    "revoked",
    "superseded",
    "unavailable",
  ]),
  association_stale: z.boolean().nullable(),
  association_at: instant.nullable(),
  reviewed_at: instant.nullable(),
  messages: z.number().int().nonnegative().safe().nullable(),
  synced_at: instant.nullable(),
  permissions: z
    .array(
      z.strictObject({
        name: z.string(),
        active: z.boolean(),
        can_send: z.boolean(),
      }),
    )
    .nullable(),
  can_send: z.boolean().nullable(),
});
export const connectionsSchema = z.strictObject({
  generated_at: instant,
  accounts: z.array(connectionAccountSchema).max(1000),
  instantly: z.strictObject({
    configuration_present: z.boolean(),
    connection_verified: z.literal(false),
  }),
});
export type ConnectionAccount = z.infer<typeof connectionAccountSchema>;
export type ConnectionsSnapshot = z.infer<typeof connectionsSchema>;
export type ConnectionTab = "gmail" | "composio" | "instantly" | "texttorrent";
export function connectionsAllowed(
  profile: Pick<Profile, "role" | "active">,
  demo = false,
) {
  return (
    profile.role === "superadmin" &&
    (demo ? profile.active !== false : profile.active === true)
  );
}
export function connectionTotals(accounts: ConnectionAccount[]) {
  return {
    accounts: accounts.length,
    gmailConnected: accounts.filter((a) => a.status === "connected").length,
    confirmed: accounts.some((a) => a.association === "unavailable")
      ? null
      : accounts.filter(
          (a) => a.association === "verified" && a.association_stale === false,
        ).length,
    messages: accounts.some((a) => a.messages === null)
      ? null
      : accounts.reduce((n, a) => n + a.messages!, 0),
  };
}
export function connectionsInitialView(search: string, allowed: boolean) {
  if (!allowed) return false;
  const p = new URLSearchParams(search);
  return p.get("module") === "connections";
}
export function demoConnections(
  accounts: {
    id: string;
    email: string;
    organization: string;
    status: string;
  }[],
): ConnectionsSnapshot {
  return {
    generated_at: "2026-11-15T15:00:00Z",
    accounts: accounts.map((a, i) => ({
      id: a.id,
      email: a.email,
      organization: a.organization,
      status: a.status,
      registered_at: "2026-10-15T15:00:00Z",
      brand: "Curated · Demo",
      association: i === 0 ? "verified" : "candidate",
      association_stale: false,
      association_at: "2026-11-10T15:00:00Z",
      reviewed_at: i === 0 ? "2026-11-14T15:00:00Z" : null,
      messages: i === 0 ? 1250 : null,
      synced_at: i === 0 ? "2026-11-15T14:55:00Z" : null,
      permissions: [
        { name: "Administrador de ejemplo", active: true, can_send: true },
      ],
      can_send: true,
    })),
    instantly: { configuration_present: false, connection_verified: false },
  };
}
