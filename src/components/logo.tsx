export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="logo-wrap">
      <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span className="logo-word">orbit</span>}
    </div>
  );
}
