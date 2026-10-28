"use client";

import { useId } from "react";

/**
 * Grafik garis mini per hari — kurva mulus (catmull-rom), area gradient,
 * gridlines tipis, label hari kecil. Pure SVG, tanpa library.
 */
const HARI = ["min", "sen", "sel", "rab", "kam", "jum", "sab"];

function lastDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getTime() - i * 86_400_000);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`);
  }
  return out;
}

/** Kurva mulus: catmull-rom → cubic bezier, biar garisnya elegan bukan zig-zag. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

export default function ActivityChart({
  title,
  data,
  color = "var(--accent)",
  days = 7,
}: {
  title: string;
  data: Map<string, number>;
  color?: string;
  days?: number;
}) {
  const raw = useId();
  const gid = `g${raw.replace(/[^a-zA-Z0-9]/g, "")}`;

  const labels = lastDays(days);
  const values = labels.map((d) => data.get(d) ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...values);
  const H = 38; // tinggi area gambar
  const PAD = 3.5; // jarak dari tepi kanan/kiri
  const step = (100 - PAD * 2) / Math.max(1, labels.length - 1);
  const y = (v: number) => H - (v / max) * (H - 5) - 2.5;
  const P = values.map((v, i) => [PAD + i * step, y(v)] as [number, number]);

  const line = smoothPath(P);
  const area = `${line} L${P[P.length - 1][0].toFixed(2)},${H} L${P[0][0].toFixed(2)},${H} Z`;
  const last = P.length - 1;

  return (
    <div className="lift rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-widest text-faint">{title}</h3>
        <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums" style={{ color }}>
          {total} · {days}d
        </span>
      </div>
      <svg viewBox="0 0 100 47" className="mt-2.5 w-full" role="img" aria-label={`${title}: ${values.join(", ")}`}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* gridlines horizontal tipis */}
        {[0.33, 0.66].map((f) => (
          <line key={f} x1="0" y1={(H * f).toFixed(1)} x2="100" y2={(H * f).toFixed(1)} stroke="var(--border)" strokeWidth="0.25" />
        ))}
        {/* baseline */}
        <line x1="0" y1={H + 0.5} x2="100" y2={H + 0.5} stroke="var(--border)" strokeWidth="0.4" />
        {/* area gradient di bawah kurva */}
        <path d={area} fill={`url(#${gid})`} />
        {/* kurva */}
        <path d={line} fill="none" stroke={color} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        {/* titik data: ring kosong, hari ini solid + halo */}
        {P.map(([x, yy], i) => (
          <g key={labels[i]}>
            {i === last && <circle cx={x.toFixed(2)} cy={yy.toFixed(2)} r="2.6" fill={color} opacity="0.2" />}
            <circle
              cx={x.toFixed(2)}
              cy={yy.toFixed(2)}
              r={i === last ? "1.4" : "1"}
              fill={i === last ? color : "var(--surface)"}
              stroke={color}
              strokeWidth="0.45"
            >
              <title>{`${labels[i]}: ${values[i]}`}</title>
            </circle>
          </g>
        ))}
        {/* label hari kecil — hari ini disorot warna garis */}
        {labels.map((d, i) => (
          <text
            key={d}
            x={(PAD + i * step).toFixed(2)}
            y={H + 4.4}
            textAnchor="middle"
            fontSize="2.9"
            fontWeight={i === last ? "700" : "400"}
            fill={i === last ? color : "var(--faint)"}
            fontFamily="var(--font-jetbrains), monospace"
          >
            {HARI[new Date(d + "T12:00:00").getDay()]}
          </text>
        ))}
      </svg>
    </div>
  );
}