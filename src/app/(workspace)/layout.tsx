import { AppShell } from "@/components/app-shell";
import { getShellContext } from "@/lib/supabase/group-data";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const shell = await getShellContext();
  return <AppShell shell={shell}>{children}</AppShell>;
}
