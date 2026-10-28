/** Badge kecil — label mono uppercase, tone menentukan warna border+teks. */
type Tone = "neutral" | "accent" | "done" | "warn" | "danger" | "tier-s" | "tier-a" | "tier-b" | "tier-c";

const TONES: Record<Tone, string> = {
  neutral: "border-border text-muted",
  accent: "border-accent/50 text-accent",
  done: "border-done/50 text-done",
  warn: "border-warn/50 text-warn",
  danger: "border-danger/50 text-danger",
  "tier-s": "border-tier-s/50 text-tier-s",
  "tier-a": "border-tier-a/50 text-tier-a",
  "tier-b": "border-tier-b/50 text-tier-b",
  "tier-c": "border-tier-c/50 text-tier-c",
};

export default function Badge({
  tone = "neutral",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center rounded-sm border px-2.5 py-0.5 text-[11px] font-bold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
