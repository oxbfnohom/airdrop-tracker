"use client";

export interface TgeEvent {
  id: number;
  name: string;
  tge_date: string | null;
  note: string;
  source: string;
  link: string;
  project_name: string | null;
  created_at: string;
}

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.ceil((new Date(date + "T00:00:00").getTime() - Date.now()) / 86_400_000);
}

/** Radar TGE — presentational: data dimilikin Dashboard biar gak fetch dobel. */
export default function TgePanel({ events, onDismiss }: { events: TgeEvent[]; onDismiss: (id: number) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-faint">
        Tanggal TGE/listing buat garapan lu, dikonfirmasi finder. Muncul di sini, kekirim ke Telegram, ilang sendiri sehari
        setelah TGE.
      </p>
      {events.map((e) => {
        const d = daysUntil(e.tge_date);
        const isMine = Boolean(e.project_name);
        const soon = d !== null && d >= 0 && d <= 7;
        return (
          <div
            key={e.id}
            className={`lift rounded-xl border p-4 ${soon ? "border-warn/50 bg-warn/5" : isMine ? "border-done/30 bg-surface" : "border-border bg-surface"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  {soon && <span className="animate-pulse-dot size-1.5 shrink-0 rounded-full bg-warn" />}
                  <span className="truncate">{e.name}</span>
                </p>
                {e.note && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">{e.note}</p>}
                <p className="mt-1 truncate font-mono text-[10px] text-faint">
                  {e.tge_date && (
                    <span className={`mr-1.5 font-bold ${soon ? "text-warn" : "text-muted"}`}>
                      {d === null ? e.tge_date : d < 0 ? `lewat ${Math.abs(d)}h` : d === 0 ? "HARI INI" : `T-${d}h`}
                    </span>
                  )}
                  <a href={e.link} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                    {e.source.replace(/^tg:/, "")}
                  </a>
                  {isMine ? ` · ${e.project_name}` : ""}
                </p>
              </div>
              <button
                onClick={() => onDismiss(e.id)}
                className="shrink-0 text-xs text-faint transition-colors hover:text-danger"
                title="Buang event ini"
                aria-label={`Buang event ${e.name}`}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
      {events.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-faint">
          Belum ada. Nunggu finder ngumumin.
        </p>
      )}
    </div>
  );
}