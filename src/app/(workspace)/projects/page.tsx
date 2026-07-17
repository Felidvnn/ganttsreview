import { ProjectsView } from "@/components/projects-view";
import { getProjects } from "@/lib/supabase/data";

export default async function ProjectsPage() {
  const projects = await getProjects();
  return <div className="projects-page"><ProjectsView projects={projects} /></div>;
}
