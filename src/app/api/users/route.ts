import { requireUser } from "@/lib/server/supabase";
import {
  executeUserCommand,
  listManagedUsers,
} from "@/lib/server/user-management";
import { userManagementResponse } from "@/lib/server/user-management-http";

export const dynamic = "force-dynamic";
const dependencies = {
  authenticate: requireUser,
  list: (
    { db }: Awaited<ReturnType<typeof requireUser>>,
    query: Parameters<typeof listManagedUsers>[1],
  ) => listManagedUsers(db, query),
  execute: (
    { db, profile }: Awaited<ReturnType<typeof requireUser>>,
    command: Parameters<typeof executeUserCommand>[2],
  ) => executeUserCommand(db, profile, command),
};
export const GET = (request: Request) =>
  userManagementResponse(request, dependencies);
export const POST = (request: Request) =>
  userManagementResponse(request, dependencies);
