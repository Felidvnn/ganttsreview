"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section className="panel workspace-error">
      <span className="metric-icon amber"><AlertTriangle /></span>
      <div><span className="eyebrow">NO PUDIMOS CARGAR ESTA VISTA</span><h2>Ocurrió un problema al consultar los datos</h2><p>Intenta nuevamente. Si continúa, comparte el código {error.digest || "mostrado en los registros"}.</p></div>
      <button className="button primary" onClick={reset}><RefreshCw size={15} /> Reintentar</button>
    </section>
  );
}
