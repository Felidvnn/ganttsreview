import { ArrowRight, CheckCircle2, Link2 } from "lucide-react";
import type { DependencyData } from "@/lib/supabase/dependency-data";

export function DependencyMap({ dependencies }: { dependencies: DependencyData[] }) {
  if (!dependencies.length) return <div className="dependency-empty"><span><Link2 /></span><h4>No hay dependencias transversales</h4><p>Cuando relaciones tareas de distintos proyectos, aparecerán aquí.</p></div>;
  return <div className="dependency-real-list">{dependencies.map((item) => <article key={item.id}><div className="dependency-real-node"><span>{item.predecessor.projectCode}</span><b>{item.predecessor.title}</b><small>{item.predecessor.projectName}</small></div><div className="dependency-arrow"><span>{item.predecessor.status === "done" ? <CheckCircle2 /> : <Link2 />}</span><ArrowRight /><small>{item.type.replaceAll("_", " → ")}</small></div><div className="dependency-real-node successor"><span>{item.successor.projectCode}</span><b>{item.successor.title}</b><small>{item.successor.projectName}</small></div></article>)}</div>;
}
