"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectView } from "@/lib/tracker";
import type { Enrichment } from "@/lib/types";
import { CHAINS } from "@/lib/types";
import Badge from "@/components/ui/Badge";
import Heatmap from "@/components/ui/Heatmap";
import ProgressBar from "@/components/ui/ProgressBar";
import { useToast } from "@/components/ui/Toast";
import EcoAdd from "@/components/EcoAdd";
import ProjectCard from "@/components/ProjectCard";

interface NewsItem {
  id: number;
  category: string;
  title: string;
  url: string;
  source: string;
  day: string;
  important: number;
}

/** Judul berita bersih di layar: link mentah dibuang — kartu ini sendiri nge-link ke pesan aslinya. */
function cleanNewsTitle(t: string): string {
  return t
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

const inputCls =
  "min-h-11 rounded-[13px] border border-border bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-border-strong";

export default function ProjectDetailPage() {
  const router = useRouter();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newTaskLink, setNewTaskLink] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const toast = useToast();

  const id = Number(new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("id") ?? 0);
  const [kids, setKids] = useState<ProjectView[]>([]);
  const [parent, setParent] = useState<ProjectView | null>(null);
  const enr: Enrichment | null = project?.enrichment ? JSON.parse(project.enrichment) : null;
  const rawFunding = (enr?.funding ?? "").trim();
  // cuma funding hasil riset web — klaim grup gak disimpulkan
  const webFunding = Boolean(rawFunding) && !/^(unknown|n\/a|-|—)$/i.test(rawFunding);
  const fundValue = webFunding ? rawFunding : "";
  const hasFunding = Boolean(fundValue);

  const load = useCallback(async () => {
    if (!id) return;
    const [p, n] = await Promise.all([
      fetch(`/api/projects/${id}/view`).then((r) => r.json()),
      fetch(`/api/news?project_id=${id}`).then((r) => r.json()),
    ]);
    if (p.error) {
      setNotFound(true);
      return;
    }
    setProject(p.project ?? null);
    setKids(p.ecosystems ?? []);
    setParent(p.parent ?? null);
    setNews(n.items ?? []);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling client-side, setState memang post-fetch
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function toggle(taskId: number, title: string, wasDone: boolean) {
    setBusy(true);
    await fetch(`/api/tasks/${taskId}/toggle`, { method: "POST" });
    await load();
    setBusy(false);
    if (!wasDone) toast("Beres. Kartu TG ke-update.", "done");
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    await fetch(`/api/projects/${id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTask, freq: "once", link: newTaskLink }),
    });
    setNewTask("");
    setNewTaskLink("");
    await load();
    toast("Misi masuk.", "done");
  }

  async function delTask(taskId: number) {
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    await load();
    toast("Misi kehapus.", "info");
  }

  async function rescan() {
    setRescanning(true);
    const data = await fetch(`/api/projects/${id}/rescan`, { method: "POST" }).then((r) => r.json());
    setRescanning(false);
    if (data.ok) {
      toast(`Ketemu ${data.news} berita, ${data.missions} misi.`, "done");
      await load();
    } else {
      toast(data.error ?? "Gagal scan.", "danger");
    }
  }

  async function patch(field: string, value: string) {
    if (field === "channel") {
      await fetch(`/api/projects/${id}/channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: value }),
      });
    } else {
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    }
    await load();
    toast("Kesimpen.", "done");
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-muted">Project gak ketemu.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-text">
          ← balik ke dashboard
        </button>
      </main>
    );
  }

  if (!project) {
    return <main className="mx-auto max-w-3xl px-4 py-16 text-center font-mono text-sm text-faint">loading…</main>;
  }

  const onceTasks = project.tasks.filter((t) => t.freq === "once");
  const dailyTasks = project.tasks.filter((t) => t.freq !== "once");
  const doneOnce = onceTasks.filter((t) => t.doneToday).length;
  const pct = onceTasks.length ? Math.round((doneOnce / onceTasks.length) * 100) : 0;
  const tgeDays = project.tge_date
    ? Math.ceil((new Date(project.tge_date + "T00:00:00").getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
    : null;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 pb-16">
      <button onClick={() => router.push("/")} className="font-mono text-[11px] text-faint transition-colors hover:text-accent">
        ← semua garapan
      </button>

      {/* anak ekosistem — kasih konteks induknya biar gak nyasar */}
      {parent && (
        <p className="font-mono text-[11px] text-faint">
          ↳ bagian dari{" "}
          <a href={`/project?id=${parent.id}`} className="text-muted transition-colors hover:text-accent">
            {parent.name}
          </a>
        </p>
      )}

      {/* header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <a href={project.url} target="_blank" rel="noreferrer" className="text-2xl font-extrabold leading-tight tracking-tight hover:text-accent">
            {project.name}
          </a>
          {project.tier && (
            <Badge tone={project.tier === "S" ? "tier-s" : project.tier === "A" ? "tier-a" : project.tier === "B" ? "tier-b" : "tier-c"}>
              TIER {project.tier}
            </Badge>
          )}
          <Badge>{project.category}</Badge>
          {hasFunding ? (
            <Badge tone="accent" title={fundValue}>
              {fundValue.length > 26 ? fundValue.slice(0, 26).replace(/\s+\S*$/, "") + "…" : fundValue}
            </Badge>
          ) : (
            <Badge title="Funding belum ada info">TBA</Badge>
          )}
          {project.chains && <Badge>{project.chains}</Badge>}
          {tgeDays !== null && (
            <Badge tone={tgeDays <= 14 ? "warn" : "neutral"}>TGE {tgeDays >= 0 ? `T-${tgeDays}` : "lewat"}</Badge>
          )}
          {project.oppSources.map((s) => (
            <a
              key={s.link}
              href={s.link}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent/50 hover:text-accent"
              title={`Buka pembahasan di ${s.group}`}
            >
              {s.group} ↗
            </a>
          ))}
        </div>
        {enr?.summary && <p className="text-sm leading-relaxed text-muted">{enr.summary}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={rescan}
            disabled={rescanning}
            className="rounded-md border border-border px-3 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            {rescanning ? "scanning…" : "Scan ulang history grup"}
          </button>
          <span className="font-mono text-[11px] text-faint">
            streak <span className="text-warn">×{project.streakDays}h</span> · {project.doneRatio} hari ini
          </span>
        </div>
      </header>

      {/* heatmap konsistensi */}
      {project.tasks.length > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-5">
          <Heatmap days={project.activeDays} weeks={26} cell={9} />
          <span className="font-mono text-[11px] text-muted">{project.activeDays.length} hari aktif</span>
        </section>
      )}

      {/* ekosistem — kartu penuh per anak, sama kayak kartu garapan lain (border hijau semua-beres / merah belum) */}
      {!project.parent_id && (kids.length > 0 || ["mainnet", "testnet"].includes(project.category)) && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">
            Ekosistem {kids.length > 0 && <span className="text-muted">({kids.length})</span>}
          </h2>
          <p className="text-[11px] leading-relaxed text-faint">Garapan kecil di dalam {project.name} — masing-masing punya task sendiri; teken Detail di kartunya buat buka.</p>
          <div className="grid items-start gap-3 xl:grid-cols-2">
            {kids.map((k) => (
              <ProjectCard key={k.id} project={k} onChanged={load} />
            ))}
          </div>
          <EcoAdd parent={project} hasKids={kids.length > 0} onAdded={load} />
        </section>
      )}

      {/* info project */}
      {enr && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">Info project</h2>
          <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-faint">Founder</span><span className="text-muted">{enr.founder ?? "-"}</span>
            <span className="text-faint">Funding</span><span className="text-muted">{hasFunding ? rawFunding : "TBA"}</span>
            <span className="text-faint">Investor</span><span className="text-muted">{enr.investors ?? "-"}</span>
            <span className="text-faint">TGE hint</span><span className="text-muted">{enr.tge_hint ?? "-"}</span>
            <span className="text-faint">Risk</span><span className="text-muted">{enr.risk ?? "-"}</span>
            {enr.whitepaper && (
              <>
                <span className="text-faint">Paper</span>
                <a className="text-accent hover:underline" href={enr.whitepaper} target="_blank" rel="noreferrer">
                  {enr.whitepaper.slice(0, 40)}
                </a>
              </>
            )}
            {enr.docs && (
              <>
                <span className="text-faint">Docs</span>
                <a className="text-accent hover:underline" href={enr.docs} target="_blank" rel="noreferrer">
                  {enr.docs.slice(0, 40)}
                </a>
              </>
            )}
            {enr.x && (
              <>
                <span className="text-faint">X</span>
                <a className="text-accent hover:underline" href={enr.x} target="_blank" rel="noreferrer">
                  {enr.x.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </>
            )}
          </div>
        </section>
      )}

      {/* sumber data — editor yang tadinya nyempil di kartu */}
      <section className="grid gap-2 rounded-xl border border-border bg-surface p-5 text-xs sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint">Tanggal TGE</span>
          <input
            type="date"
            defaultValue={project.tge_date ?? ""}
            onChange={(e) => patch("tge_date", e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint">RSS blog</span>
          <input
            type="url"
            defaultValue={project.rss_url || ""}
            placeholder="https://project.xyz/feed.xml"
            onBlur={(e) => e.target.value !== (project.rss_url || "") && patch("rss_url", e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint">Channel TG</span>
          <input
            type="text"
            defaultValue={project.tgChannel ?? ""}
            placeholder="kosong = auto dari handle X"
            onBlur={(e) => e.target.value !== (project.tgChannel ?? "") && patch("channel", e.target.value)}
            className={inputCls}
          />
        </label>
      </section>

      {/* misi */}
      <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">
            Misi {onceTasks.length > 0 && <span className="text-muted">({doneOnce}/{onceTasks.length})</span>}
          </h2>
        </div>
        {onceTasks.length > 0 && <ProgressBar pct={pct} tone={pct === 100 ? "done" : "accent"} />}

        {onceTasks.length > 0 && (
          <ul className="space-y-1.5">
            {onceTasks.map((t) => (
              <li key={t.id} className="group flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={t.doneToday}
                  disabled={busy}
                  onChange={() => toggle(t.id, t.title, t.doneToday)}
                  className="size-5 shrink-0 cursor-pointer appearance-none rounded-[10px] border border-border-strong bg-bg transition-colors checked:border-done checked:bg-done disabled:opacity-40"
                  aria-label={t.title}
                />
                {t.link ? (
                  <a
                    href={t.link}
                    target="_blank"
                    rel="noreferrer"
                    className={`min-w-0 flex-1 truncate transition-colors hover:text-accent hover:underline ${t.doneToday ? "text-faint line-through" : ""}`}
                    title={`Buka tugas: ${t.link}`}
                  >
                    {t.title}
                    <span className="ml-1.5 align-middle font-mono text-[10px] text-tier-a">1×</span>
                    <span className="ml-1.5 align-middle font-mono text-[10px] text-accent">↗</span>
                  </a>
                ) : (
                  <span className={`min-w-0 flex-1 ${t.doneToday ? "text-faint line-through" : ""}`}>
                    {t.title}
                    <span className="ml-1.5 align-middle font-mono text-[10px] text-tier-a">1×</span>
                  </span>
                )}
                {t.source && (
                  <a
                    href={t.source}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-mono text-[11px] text-faint transition-colors hover:text-accent"
                    title="Buka pesan grup yang bahas quest ini"
                    aria-label={`Pesan grup sumber ${t.title}`}
                  >
                    💬
                  </a>
                )}
                {t.onchain === 1 && <span className="font-mono text-[10px] text-accent">{CHAINS[t.chain]?.name ?? t.chain}</span>}
                <button onClick={() => delTask(t.id)} className="text-xs text-faint opacity-60 hover:text-danger group-hover:opacity-100" aria-label={`Hapus misi ${t.title}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {dailyTasks.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-faint">Rutin</p>
            <ul className="space-y-1.5">
              {dailyTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={t.doneToday}
                    disabled={busy}
                    onChange={() => toggle(t.id, t.title, t.doneToday)}
                    className="size-5 shrink-0 cursor-pointer appearance-none rounded-[10px] border border-border-strong bg-bg transition-colors checked:border-done checked:bg-done disabled:opacity-40"
                    aria-label={t.title}
                  />
                  <span className={`min-w-0 flex-1 ${t.doneToday ? "text-faint line-through" : ""}`}>
                    {t.title}
                    {t.freq === "weekly" && <span className="ml-1.5 align-middle font-mono text-[10px] text-muted">mingguan</span>}
                    {t.streak > 0 && t.freq === "daily" && (
                      <span className="ml-1.5 align-middle font-mono text-[10px] font-bold text-warn">×{t.streak}</span>
                    )}
                  </span>
                  {t.source && (
                    <a
                      href={t.source}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 font-mono text-[11px] text-faint transition-colors hover:text-accent"
                      title="Buka pesan grup yang bahas quest ini"
                      aria-label={`Pesan grup sumber ${t.title}`}
                    >
                      💬
                    </a>
                  )}
                  {t.onchain === 1 && <span className="font-mono text-[10px] text-accent">{CHAINS[t.chain]?.name ?? t.chain}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={addTask} className="flex flex-wrap gap-2 text-xs">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="+ misi manual…"
            className={`min-w-24 flex-1 ${inputCls}`}
          />
          <input
            value={newTaskLink}
            onChange={(e) => setNewTaskLink(e.target.value)}
            placeholder="link tugas (opsional)"
            className={`min-w-32 flex-1 ${inputCls}`}
          />
          <button className="rounded-md border border-border px-2.5 py-1 transition-colors hover:bg-surface-2">add</button>
        </form>
      </section>

      {/* berita */}
      <section className="space-y-2 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">
          Berita project ini <span className="text-muted">({news.length})</span>
        </h2>
        {news.length === 0 ? (
          <p className="text-xs leading-relaxed text-faint">
            Belum ada. Begitu ada yang bahas {project.name}, muncul di sini.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {news.map((n) => (
              <li key={n.id}>
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-2.5 rounded-lg border border-border bg-bg p-2.5 text-sm transition-colors hover:border-accent/50"
                  title={n.source.startsWith("tg:") ? "Buka pesan aslinya di Telegram" : "Buka sumber berita"}
                >
                  <Badge tone={CAT_TONE[n.category] ?? "neutral"}>{n.category}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 whitespace-pre-line leading-snug" title={n.title}>
                      {cleanNewsTitle(n.title) || "🔗 pesan (cuma link)"}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
                      {n.day} · {n.source.replace(/^tg:/, "").slice(0, 40)}
                    </p>
                  </div>
                  <span className="mt-1 shrink-0 font-mono text-[10px] text-faint">↗</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}