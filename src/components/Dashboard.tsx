"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectView } from "@/lib/tracker";
import Header, { type Tab } from "./Header";
import AddProjectForm from "./AddProjectForm";
import ProjectCard from "./ProjectCard";
import NewsPanel from "./NewsPanel";
import OpportunitiesPanel from "./OpportunitiesPanel";
import SettingsPanel from "./SettingsPanel";
import { useToast } from "./ui/Toast";
import ActivityChart from "./ui/ActivityChart";
import DonutChart from "./ui/DonutChart";
import Skeleton from "./ui/Skeleton";
import TgePanel, { daysUntil, type TgeEvent } from "./TgePanel";

/** Jenis garapan — urutan chips sub-navigasi + warna donut (retro dulu, kata user). */
const CAT_META: Array<{ key: string; label: string; color: string }> = [
  { key: "retro", label: "Retro", color: "var(--warn)" },
  { key: "mainnet", label: "Mainnet", color: "var(--tier-a)" },
  { key: "testnet", label: "Testnet", color: "var(--tier-b)" },
  { key: "nft", label: "NFT", color: "var(--tier-s)" },
  { key: "quest", label: "Quest", color: "var(--accent)" },
  { key: "social", label: "Social", color: "var(--tier-s)" },
  { key: "other", label: "Lainnya", color: "var(--tier-c)" },
];

const TAB_TITLE: Record<Tab, string> = { today: "Garapan", news: "Berita", oppo: "Peluang", settings: "Setelan" };

/** Angka besar sekilas pas — inti dashboard harian. */
function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "accent" | "warn" | "danger" | "done" }) {
  const toneCls =
    tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "done" ? "text-done" : "";
  return (
    <div className="lift rounded-xl border border-border bg-surface p-4">
      <p className={`font-mono text-xl font-extrabold leading-none tabular-nums ${toneCls}`}>{value}</p>
      <p className="mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint">{label}</p>
    </div>
  );
}

/** Peta garapan: tiap jenis satu baris — jumlah garapan & yang belum beres. Klik = masuk jenis itu.
 *  Pengganti kotak kosong "pilih jenis": sekali pandang langsung keliatan mana yang ada kerjaan. */
function PetaGarapan({ projects, onPick }: { projects: ProjectView[]; onPick: (k: string) => void }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border">
      {CAT_META.map((m) => {
        const list = projects.filter((p) => p.category === m.key);
        if (list.length === 0) return null;
        const pending = list.reduce((n, p) => n + p.tasks.filter((t) => !t.doneToday).length, 0);
        return (
          <button
            key={m.key}
            onClick={() => onPick(m.key)}
            className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: m.color }} />
            <span className="flex-1 font-mono text-xs font-bold uppercase tracking-widest" style={{ color: m.color }}>
              {m.label}
            </span>
            <span className="font-mono text-[11px] text-muted">{list.length} garapan</span>
            {pending > 0 ? (
              <span className="font-mono text-[11px] font-bold text-warn">{pending} belum</span>
            ) : (
              <span className="font-mono text-[11px] text-done">beres</span>
            )}
            <span className="shrink-0 font-mono text-xs text-faint">→</span>
          </button>
        );
      })}
    </section>
  );
}

export default function Dashboard() {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [tab, setTab] = useState<Tab>("today");
  const [refreshing, setRefreshing] = useState(false);
  const [oppoCount, setOppoCount] = useState(0);
  const [tgeEvents, setTgeEvents] = useState<TgeEvent[]>([]);
  const [streak, setStreak] = useState(0);
  const [q, setQ] = useState("");
  // "auto" = user belum pilih jenis → turun ke jenis pending terbanyak (lihat cat di bawah);
  // string = jenis yang diklik user; null = peta garapan (ikhtisar semua jenis)
  const [catPick, setCatPick] = useState<string | null | "auto">("auto");
  const [oppPerDay, setOppPerDay] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setRefreshing(true);
    const [p, o, t] = await Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/opportunities").then((r) => r.json()),
      fetch("/api/tge").then((r) => r.json()),
    ]);
    setProjects(p.projects ?? []);
    setOppoCount((o.opportunities ?? []).length);
    setOppPerDay(o.perDay ?? {});
    setTgeEvents(t.events ?? []);
    setStreak(p.streak ?? 0);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling client-side, setState memang post-fetch
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function dismissTge(id: number) {
    setTgeEvents((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/tge?id=${id}`, { method: "DELETE" });
  }

  const pendingProjects = projects.filter((p) => p.tasks.some((t) => !t.doneToday));
  const allDone = projects.length > 0 && pendingProjects.length === 0;
  const pendingTasks = projects.reduce((n, p) => n + p.tasks.filter((t) => !t.doneToday).length, 0);
  const allDoneCount = projects.filter((p) => p.tasks.length > 0 && p.tasks.every((t) => t.doneToday)).length;
  const ql = q.trim().toLowerCase();
  const visibleProjects = ql
    ? projects.filter(
        (p) =>
          `${p.name} ${p.category}`.toLowerCase().includes(ql) ||
          // garapan induk ikut kebawa kalau yang ketemu itu salah satu anak ekosistemnya
          projects.some((c) => c.parent_id === p.id && `${c.name} ${c.category}`.toLowerCase().includes(ql)),
      )
    : projects;

  // 7 hari terakhir (lokal) — kunci grafik aktivitas
  const weekDays = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const x = new Date(now.getTime() - i * 86_400_000);
      out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`);
    }
    return out;
  }, []);
  const streakTxt = streak > 0 ? ` 🔥 ${streak} hari beruntun.` : "";
  const statusLine =
    projects.length === 0
      ? "loading…"
      : allDone
        ? `semua beres, santai.${streakTxt}`
        : `${projects.length} project, ${pendingProjects.length} belum kelar.${streakTxt}`;

  // rayakan pas transisi jadi semua beres — sekali aja, bukan tiap polling
  const toast = useToast();
  const prevAllDone = useRef(false);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      prevAllDone.current = allDone;
      return;
    }
    if (allDone && !prevAllDone.current) {
      toast(`Semua garapan beres! 🔥 streak ${streak} hari.`, "done");
    }
    prevAllDone.current = allDone;
  }, [allDone, streak, toast]);

  // sekali aja pas data pertama masuk: langsung buka jenis yang pending task-nya terbanyak —
  // buka web = langsung ketemu kerjaan, bukan kotak "pilih jenis dulu".
  // jenis default = yang pending task-nya terbanyak — TURUNAN dari data (bukan effect, biar gak
  // melanggar rule react): buka web = langsung ketemu kerjaan, bukan kotak "pilih jenis dulu".
  // catPick "auto" = user belum ngeklik chip jenis; setelah klik, pilihan user yang menang.
  const autoCat = useMemo(() => {
    const score = new Map<string, number>();
    for (const p of projects) for (const t of p.tasks) if (!t.doneToday) score.set(p.category, (score.get(p.category) ?? 0) + 1);
    return [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [projects]);
  const cat = catPick === "auto" ? autoCat : catPick;

  // TGE ≤7 hari buat garapan sendiri → banner prioritas
  const myTge = tgeEvents.filter((e) => {
    if (!e.project_name || !e.tge_date) return false;
    const d = daysUntil(e.tge_date) ?? 99;
    return d >= -1 && d <= 7;
  });

  return (
    <div className="min-h-dvh pb-24 md:pb-8 md:pl-56">
      <Header tab={tab} onTab={setTab} oppoCount={oppoCount} refreshing={refreshing} onRefresh={() => void load()} statusLine={statusLine} />

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        {/* judul display ala referensi: gede, extrabold, tracking rapat */}
        <div className="mb-6">
          <h1 className="text-[clamp(1.75rem,4vw,2.5rem)] font-extrabold leading-none tracking-tight">{TAB_TITLE[tab]}</h1>
          <p className="mt-2 text-sm text-muted">{statusLine}</p>
        </div>

        {/* strip statistik — angka yang perlu diketahui sebelum scroll apa pun */}
        {tab === "today" && projects.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Stat label="garapan aktif" value={projects.length} />
            <Stat label="task pending" value={pendingTasks} tone={pendingTasks > 0 ? "warn" : "done"} />
            <Stat label="kelar semua" value={allDoneCount} tone="done" />
            <Stat label="streak" value={streak > 0 ? `${streak} hari` : "—"} tone={streak > 0 ? "warn" : undefined} />
            <Stat label="peluang nunggu" value={oppoCount} tone={oppoCount > 0 ? "accent" : undefined} />
          </div>
        )}

        {/* dashboard: grafik garis + donut jenis garapan + streak (di strip statistik) */}
        {tab === "today" && projects.length > 0 && (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ActivityChart
              title="garapan aktif / hari"
              data={new Map(weekDays.map((d) => [d, projects.filter((p) => p.activeDays.includes(d)).length]))}
            />
            <ActivityChart title="peluang masuk / hari" data={new Map(Object.entries(oppPerDay))} color="var(--tier-a)" />
            <DonutChart
              title="jenis garapan lo"
              segments={CAT_META.map((m) => ({
                label: m.label,
                value: projects.filter((p) => p.category === m.key).length,
                color: m.color,
              })).filter((s) => s.value > 0)}
            />
          </div>
        )}

        {tab === "today" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div className="min-w-0 space-y-5">
              {myTge.length > 0 && (
                <button
                  onClick={() => {
                    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-tge-radar]")).find((e) => e.offsetParent !== null);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="block w-full rounded-[13px] border border-warn/50 bg-warn/5 p-3.5 text-left transition-colors hover:border-warm"
                >
                  <p className="flex items-center gap-2 text-xs font-bold text-warn">
                    <span className="animate-pulse-dot size-1.5 rounded-full bg-warn" />
                    TGE TERKONFIRMASI{myTge.length > 1 ? ` (${myTge.length} project)` : ""}
                  </p>
                  {myTge.slice(0, 2).map((e) => (
                    <p key={e.id} className="mt-1 font-mono text-[11px] text-muted">
                      {e.name}, {e.tge_date}, dari {e.source.replace(/^tg:/, "")}
                    </p>
                  ))}
                </button>
              )}

              <AddProjectForm onAdded={load} />

              {/* chips jenis garapan — teken buat masuk ke jenis itu doang (strict),
                  teken lagi buat balik ke ikhtisar */}
              {projects.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {CAT_META.map((m) => {
                    const n = projects.filter((p) => p.category === m.key).length;
                    if (n === 0) return null;
                    const active = cat === m.key;
                    return (
                      <button
                        key={m.key}
                        onClick={() => setCatPick(active ? null : m.key)}
                        className={`rounded-sm border px-3 py-1.5 font-mono text-[11px] font-bold tracking-wide transition-colors ${
                          active
                            ? "border-transparent text-bg"
                            : "border-border text-muted hover:border-border-strong hover:text-text"
                        }`}
                        style={active ? { background: m.color } : undefined}
                      >
                        <span
                          className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                          style={{ background: active ? "var(--bg)" : m.color }}
                        />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {projects.length >= 4 && cat !== null && (
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={`cari di ${CAT_META.find((m) => m.key === cat)?.label.toLowerCase()}…`}
                  className="min-h-11 rounded-[13px] border border-border bg-bg px-4 text-sm outline-none transition-colors placeholder:text-faint focus:border-border-strong"
                />
              )}

              {cat === null ? (
                projects.length > 0 ? (
                  <PetaGarapan projects={projects} onPick={setCatPick} />
                ) : refreshing ? (
                  // buka pertama: skeleton bentuk kartu, bukan kedip kosong
                  <div className="grid gap-3 xl:grid-cols-2">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-72 w-full" />
                    ))}
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm text-faint rounded-xl border border-dashed border-border">
                    Belum ada project. Tempel link di atas.
                  </p>
                )
              ) : (
                (() => {
                  const catList = visibleProjects
                    .filter((p) => p.category === cat && !p.parent_id) // anak ekosistem dirender di bawah induknya, bukan di level atas
                    .sort((a, b) => Number(b.tasks.some((t) => !t.doneToday)) - Number(a.tasks.some((t) => !t.doneToday)));
                  const meta = CAT_META.find((m) => m.key === cat);
                  return (
                    <section className="space-y-3">
                      <h2 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest" style={{ color: meta?.color }}>
                        <span className="size-1.5 rounded-full" style={{ background: meta?.color }} />
                        {meta?.label}
                        <span className="rounded-sm bg-surface-2 px-1 text-[10px] font-semibold text-muted">{catList.length}</span>
                      </h2>
                      <div className="grid items-start gap-3 xl:grid-cols-2">
                        {catList.map((p) => (
                          <ProjectCard
                            key={p.id}
                            project={p}
                            // jumlah ekosistem aktif — lengkapnya (task & tambah/hapus) di halaman Detail
                            ecoCount={projects.filter((c) => c.parent_id === p.id).length}
                            onChanged={load}
                          />
                        ))}
                      </div>
                      {catList.length === 0 && (
                        <p className="py-8 text-center text-sm text-faint rounded-xl border border-dashed border-border">
                          {q.trim() ? `Gak ada yang cocok sama "${q.trim()}".` : "Kosong di jenis ini."}
                        </p>
                      )}
                    </section>
                  );
                })()
              )}

              {/* radar TGE — inline di mobile, rail terpisah di desktop */}
              {tgeEvents.length > 0 && (
                <section className="space-y-2 lg:hidden" data-tge-radar>
                  <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">TGE radar</h2>
                  <TgePanel events={tgeEvents} onDismiss={dismissTge} />
                </section>
              )}
            </div>

            <aside className="hidden lg:block">
              <div className="sticky top-16 space-y-2" data-tge-radar>
                <h2 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">
                  TGE radar
                  {tgeEvents.length > 0 && (
                    <span className="rounded-sm bg-surface-2 px-1 text-[10px] text-muted">{tgeEvents.length}</span>
                  )}
                </h2>
                <TgePanel events={tgeEvents} onDismiss={dismissTge} />
              </div>
            </aside>
          </div>
        ) : tab === "news" ? (
          <NewsPanel />
        ) : tab === "oppo" ? (
          <OpportunitiesPanel />
        ) : (
          <SettingsPanel onChanged={load} />
        )}
      </main>
    </div>
  );
}