"use client";

/**
 * Grafik bulat (donut) — persentase jenis garapan yang lagi dikerjain.
 * Teknik stroke-dasharray: lingkaran keliling 100, tiap segmen = persentasenya,
 * dikasih celah tipis antar segmen biar elegan.
 */
export interface Segment {
  label: string;
  value: number;
  color: string;
}

/** Persentase + offset kumulatif tiap segmen (di luar komponen biar gak mutasi state render). */
function cumulative(segments: Segment[], total: number): Array<{ pct: number; off: number }> {
  let acc = 0;
  return segments.map((s) => {
    const pct = total > 0 ? (s.value / total) * 100 : 0;
    const item = { pct, off: acc };
    acc += pct;
    return item;
  });
}

const GAP = 1.6; // celah antar segmen (satuan persen keliling)

export default function DonutChart({ title, segments }: { title: string; segments: Segment[] }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const geo = cumulative(segments, total);

  const rings = segments.map((s, i) => (
    <circle
      key={s.label}
      cx="21"
      cy="21"
      r="15.9155"
      fill="none"
      stroke={s.color}
      strokeWidth="5"
      strokeDasharray={`${Math.max(0, geo[i].pct - GAP)} ${100 - Math.max(0, geo[i].pct - GAP)}`}
      strokeDashoffset={25 - geo[i].off + GAP / 2}
    >
      <title>{`${s.label}: ${s.value} (${Math.round(geo[i].pct)}%)`}</title>
    </circle>
  ));

  return (
    <div className="lift rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-widest text-faint">{title}</h3>
        <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-muted">{total} total</span>
      </div>
      <div className="mt-2.5 flex items-center gap-4">
        <svg viewBox="0 0 42 42" className="size-[76px] shrink-0" role="img" aria-label={`${title} per jenis`}>
          {/* ring dasar biar gak kosong kalau total 0 */}
          <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--surface-2)" strokeWidth="5" />
          {rings}
          <text x="21" y="20.4" textAnchor="middle" fontSize="6.4" fontWeight="700" fill="var(--text)" fontFamily="var(--font-jetbrains), monospace">
            {total}
          </text>
          <text x="21" y="26.2" textAnchor="middle" fontSize="2.8" fill="var(--faint)" fontFamily="var(--font-jetbrains), monospace">
            garapan
          </text>
        </svg>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {segments.map((s) => {
            const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
            return (
              <li key={s.label} className="group/leg">
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate text-muted">{s.label}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-faint">
                    {s.value} · {pct}%
                  </span>
                </div>
                {/* bar mini per jenis — proporsional */}
                <div className="mt-0.5 h-[2.5px] overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}