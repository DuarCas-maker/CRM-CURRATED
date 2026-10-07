import { redirect } from "next/navigation";
import CRM from "@/components/crm";
import { configured, HttpError } from "@/lib/server/supabase";
import { loadWorkspace } from "@/lib/server/workspace";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!configured()) redirect("/login");
  let data;
  try {
    data = await loadWorkspace();
  } catch (e) {
    if (e instanceof HttpError && [401, 403].includes(e.status))
      redirect("/login");
    throw e;
  }
  return <CRM initial={data} />;
}
