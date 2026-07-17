export default function WorkspaceLoading() {
  return (
    <div className="workspace-loading" role="status" aria-live="polite" aria-label="Cargando contenido">
      <section className="loading-heading">
        <span className="loading-line loading-kicker" />
        <span className="loading-line loading-title" />
        <span className="loading-line loading-copy" />
      </section>
      <section className="loading-metrics">
        {Array.from({ length: 4 }, (_, index) => <span className="loading-card" key={index} />)}
      </section>
      <section className="loading-content">
        <span className="loading-panel" />
        <span className="loading-panel" />
      </section>
      <span className="sr-only">Cargando página…</span>
    </div>
  );
}
