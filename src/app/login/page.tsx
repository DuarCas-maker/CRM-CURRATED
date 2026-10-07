import { configured, demoEnabled } from "@/lib/server/supabase";
import Login from "@/components/login";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return <Login configured={configured()} demoEnabled={demoEnabled()} />;
}
