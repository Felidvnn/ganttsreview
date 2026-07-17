export function ProgressRing({ value, size = 64, color = "#2b7366" }: { value: number; size?: number; color?: string }) {
  return (
    <div className="progress-ring" style={{ "--value": `${value * 3.6}deg`, "--ring-color": color, width: size, height: size } as React.CSSProperties}>
      <span>{value}<small>%</small></span>
    </div>
  );
}
