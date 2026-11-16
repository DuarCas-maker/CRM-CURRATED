import { z } from "zod";
import type { Profile } from "./domain";

export const managedRoles = [
  "superadmin",
  "seller_admin",
  "seller",
  "closer_admin",
  "closer",
] as const;
const role = z.enum(managedRoles);
export const managedPassword = z.string().min(12).max(128);
export const userCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      request_id: z.uuid(),
      name: z.string().trim().min(1).max(100),
      email: z
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
      role,
      password: managedPassword,
    })
    .strict(),
  z
    .object({
      action: z.literal("access"),
      user_id: z.uuid(),
      role,
      active: z.boolean(),
      expected_role: role,
      expected_active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("password"),
      user_id: z.uuid(),
      password: managedPassword,
    })
    .strict(),
  z
    .object({
      action: z.literal("private_text"),
      user_id: z.uuid(),
      text: z.string().max(4000),
      expected_version: z.number().int().min(0).max(2147483646),
    })
    .strict(),
  z.object({ action: z.literal("reveal"), user_id: z.uuid() }).strict(),
]);
export type UserCommand = z.infer<typeof userCommandSchema>;
export const managedUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role,
  active: z.boolean(),
  has_private_text: z.boolean(),
  private_version: z.number().int().nonnegative(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;
export const userPageSchema = z.object({
  items: z.array(managedUserSchema).max(25),
  total: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
});
export type UserPage = z.infer<typeof userPageSchema>;
export const userListQuerySchema = z
  .object({
    q: z.string().max(100).default(""),
    page: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type UserListQuery = z.infer<typeof userListQuerySchema>;
export function canManageUsers(
  profile: Pick<Profile, "role" | "active">,
  demo = false,
) {
  return (
    profile.role === "superadmin" &&
    profile.active !== false &&
    (profile.active === true || demo)
  );
}
