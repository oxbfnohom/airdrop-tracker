/** Progress bar — track tegas, isi warna done (beres) atau accent (jalan). */
export default function ProgressBar({
  pct,
  tone = "done",
  className = "",
}: {
  pct: number;
  tone?: "done" | "accent" | "warn";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill = tone === "done" ? "bg-done" : tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${fill}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
