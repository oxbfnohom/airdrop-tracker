/** Heatmap aktivitas ala GitHub — kotak nyala kalau hari itu ada task ter-log (data: activeDays). */
const DAY_MS = 86_400_000;

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Heatmap({ days, weeks = 12, cell = 10 }: { days: string[]; weeks?: number; cell?: number }) {
  const set = new Set(days);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  // mulai dari Senin, (weeks-1) minggu sebelum minggu ini biar kolom rapi Senin–Minggu
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
  const cols: string[] = [];
  for (let d = new Date(monday); d.getTime() <= today.getTime(); d = new Date(d.getTime() + DAY_MS)) cols.push(fmt(d));

  return (
    <div className="flex gap-[2px] overflow-hidden" role="img" aria-label={`Aktif ${days.length} hari dalam ${weeks} minggu terakhir`}>
      {Array.from({ length: weeks }, (_, w) => (
        <div key={w} className="flex flex-col gap-[2px]">
          {Array.from({ length: 7 }, (_, r) => {
            const date = w * 7 + r < cols.length ? cols[w * 7 + r] : null;
            const lit = date !== null && set.has(date);
            return (
              <span
                key={r}
                title={date ? `${date}${lit ? " (aktif)" : ""}` : undefined}
              className={`size-1.5 shrink-0 rounded-[3px] ${lit ? "bg-accent" : date ? "bg-surface-2" : "bg-transparent"}`}
                style={{ width: cell, height: cell }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
