import { notFound } from "next/navigation";
import CRM from "@/components/crm";
import { demoWorkspace } from "@/lib/demo";
import { demoEnabled } from "@/lib/server/supabase";
export const dynamic = "force-dynamic";
export default function Demo() {
  if (!demoEnabled()) notFound();
  return <CRM initial={demoWorkspace()} />;
}
