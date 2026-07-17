import { GroupManager } from "@/components/group-manager";
import { getGroupData } from "@/lib/supabase/group-data";

export default async function GroupPage() {
  const data = await getGroupData();
  return <div className="team-page"><GroupManager data={data} /></div>;
}
