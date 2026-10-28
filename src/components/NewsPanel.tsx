"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { timeAgo } from "@/lib/format";
import Badge from "./ui/Badge";
import Skeleton from "./ui/Skeleton";
import { useToast } from "./ui/Toast";

interface NewsItem {
  id: number;
  project_name: string | null;
  source: string;
  title: string;
  url: string;
  category: string;
  important: number;
  day: string;
  created_at: string;
}

const CAT_TONE: Record<string, "warn" | "danger" | "accent" | "done" | "neutral"> = {
  tge: "warn",
  snapshot: "danger",
  mainnet: "accent",
  listing: "done",
  claim: "done",
  deadline: "warn",
  tokenomics: "accent",
  funding: "accent",
  other: "neutral",
};

/** Judul bersih di layar: link mentah dibuang — link sumber udah nempel di judul (klik = buka). */
function cleanTitle(t: string): string {
  return t
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function NewsPanel() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    const res = await fetch("/api/news");
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling client-side, setState memang post-fetch
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function pollNow() {
    setBusy(true);
    const r = await fetch("/api/cron/news", { method: "POST" }).then((x) => x.json());
    await load();
    setBusy(false);
    const n = r.inserted ?? 0;
    toast(n > 0 ? `${n} berita baru.` : "Nggak ada yang baru.", n > 0 ? "done" : "info");
  }

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of items) m.set(n.category, (m.get(n.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const ql = q.trim().toLowerCase();
  const shown = items.filter(
    (n) =>
      (cat === "all" || n.category === cat) &&
      (!ql || `${n.title} ${n.project_name ?? ""}`.toLowerCase().includes(ql)),
  );
  const groups = useMemo(() => {
    const g = new Map<string, NewsItem[]>();
    for (const n of shown) {
      const key = n.project_name ?? "Lainnya";
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(n);
    }
    return [...g.entries()];
  }, [shown]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Berita per project, dari channel resmi, grup, dan RSS. Kescan tiap 5 menit.</p>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="cari berita…"
            className="min-h-11 w-full max-w-56 rounded-[13px] border border-border bg-bg px-4 text-sm outline-none transition-colors placeholder:text-faint focus:border-border-strong"
          />
          <button
            onClick={pollNow}
            disabled={busy}
            className="min-h-11 rounded-[13px] border border-border px-4 py-2 text-[13px] font-bold text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            {busy ? "Scanning…" : "Scan sekarang"}
          </button>
        </div>
      </div>

      {cats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCat("all")}
            className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              cat === "all" ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-text"
            }`}
          >
            semua {items.length}
          </button>
          {cats.map(([c, n]) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                cat === c ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-text"
              }`}
            >
              {c} {n}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-faint">
          {q.trim() ? "Gak ada berita yang cocok." : "Masih kosong. Berita muncul sendiri begitu project punya channel atau RSS."}
        </p>
      ) : (
        groups.map(([project, news]) => (
          <section key={project} className="space-y-2">
            <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">
              {project}
              <span className="rounded-sm bg-surface-2 px-1 text-[10px] text-muted">{news.length}</span>
            </h3>
            <ul className="space-y-1.5">
              {news.map((n) => (
                <li
                  key={n.id}
                  className={`lift flex items-start gap-3 rounded-xl border bg-surface p-4 text-sm ${
                    n.important ? "border-warn/40" : "border-border"
                  }`}
                >
                  <Badge tone={CAT_TONE[n.category] ?? "neutral"}>{n.category}</Badge>
                  <div className="min-w-0">
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="leading-snug hover:text-accent hover:underline"
                      title={n.title}
                    >
                      {cleanTitle(n.title) || "🔗 pesan (cuma link)"}
                    </a>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
                      {timeAgo(n.day)} · {n.source.replace(/^tg:/, "").replace(/^https?:\/\//, "").slice(0, 40)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}