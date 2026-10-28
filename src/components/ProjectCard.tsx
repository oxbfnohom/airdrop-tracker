"use client";

import { useState } from "react";
import type { ProjectView, TaskView } from "@/lib/tracker";
import type { Enrichment } from "@/lib/types";
import { CHAINS, FREQS } from "@/lib/types";
import Badge from "./ui/Badge";
import ProgressBar from "./ui/ProgressBar";
import Heatmap from "./ui/Heatmap";
import ConfirmDialog from "./ui/ConfirmDialog";
import { useToast } from "./ui/Toast";

function daysUntil(date: string): number {
  return Math.ceil((new Date(date + "T00:00:00").getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
}

/** Warna "tipe" kartu ala Pokemon: tiap kategori punya elemen sendiri. */
const TYPE: Record<string, string> = {
  testnet: "var(--tier-b)",
  mainnet: "var(--tier-a)",
  retro: "var(--warn)",
  quest: "var(--accent)",
  nft: "var(--tier-s)",
  social: "var(--tier-s)",
  other: "var(--tier-c)",
};

const TIER_COLOR: Record<string, string> = {
  S: "var(--tier-s)",
  A: "var(--tier-a)",
  B: "var(--tier-b)",
  C: "var(--tier-c)",
};

/** Simbol rarity ala kartu Pokemon: ★ ada TGE, ◆ ada funding, ● baru mulai. */
function rarity(project: ProjectView, hasFunding: boolean): { sym: string; label: string; color: string } {
  if (project.tge_date) return { sym: "★", label: "Rare — TGE kekunci", color: "var(--warn)" };
  if (hasFunding) return { sym: "◆", label: "Uncommon — udah ada funding", color: "var(--tier-b)" };
  return { sym: "●", label: "Common — belum ada funding", color: "var(--tier-c)" };
}

function TaskRow({ task, busy, onToggle, onDelete }: { task: TaskView; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  const [justDone, setJustDone] = useState(false);
  // quest (once/weekly) yang punya link: teken judulnya = buka halaman tugasnya langsung
  const taskLink = task.freq !== "daily" && task.link ? task.link : null;
  const titleBody = (
    <>
      {task.title}
      {task.freq === "once" && <span className="ml-1.5 align-middle font-mono text-[10px] text-tier-a">1×</span>}
      {task.auto && <span className="ml-1.5 align-middle font-mono text-[10px] text-accent">auto</span>}
      {task.freq === "weekly" && <span className="ml-1.5 align-middle font-mono text-[10px] text-muted">mingguan</span>}
      {task.streak > 0 && task.freq === "daily" && (
        <span className="ml-1.5 align-middle font-mono text-[10px] font-bold text-warn">×{task.streak}</span>
      )}
      {taskLink && <span className="ml-1.5 shrink-0 align-middle font-mono text-[10px] text-accent">↗</span>}
    </>
  );
  return (
    <li className="group flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={task.doneToday}
        disabled={busy}
        onChange={() => {
          if (!task.doneToday) {
            setJustDone(true);
            setTimeout(() => setJustDone(false), 400);
          }
          onToggle();
        }}
        className={`size-6 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-text/70 bg-bg transition-all hover:border-text checked:border-done checked:bg-done disabled:cursor-default disabled:opacity-40 ${
          justDone ? "animate-check" : ""
        }`}
        aria-label={task.title}
      />
      {taskLink ? (
        <a
          href={taskLink}
          target="_blank"
          rel="noreferrer"
          className={`min-w-0 flex-1 truncate leading-snug transition-colors hover:text-accent hover:underline ${
            task.doneToday ? "text-faint line-through" : ""
          }`}
          title={`Buka tugas: ${taskLink}`}
        >
          {titleBody}
        </a>
      ) : (
        <button
          type="button"
          onClick={() => !busy && onToggle()}
          className={`min-w-0 flex-1 cursor-pointer truncate text-left leading-snug transition-colors ${
            task.doneToday ? "text-faint line-through" : "hover:text-accent"
          }`}
          title={task.doneToday ? "Klik buat batalin" : "Klik = beres"}
        >
          {titleBody}
        </button>
      )}
      {task.source && (
        <a
          href={task.source}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-mono text-[11px] text-faint transition-colors hover:text-accent"
          title="Buka pesan grup yang bahas quest ini"
          aria-label={`Pesan grup sumber ${task.title}`}
        >
          💬
        </a>
      )}
      {task.onchain === 1 && (
        <span className="shrink-0 font-mono text-[10px] text-accent" title="dicek otomatis on-chain tiap 30 menit">
          {CHAINS[task.chain]?.name ?? task.chain}
        </span>
      )}
      <button
        onClick={onDelete}
        className="shrink-0 text-xs text-faint opacity-60 transition-colors hover:text-danger group-hover:opacity-100"
        title="Hapus task"
        aria-label={`Hapus task ${task.title}`}
      >
        ✕
      </button>
    </li>
  );
}

/** Klik nama garapan = langsung ke link garapan-nya (tab baru); gak ada url → ke halaman detail. */
function projectHref(p: ProjectView): string {
  const ext = (p.url ?? "").trim();
  return ext ? (/^https?:\/\//i.test(ext) ? ext : `https://${ext}`) : `/project?id=${p.id}`;
}

export default function ProjectCard({
  project,
  ecoCount = 0,
  onChanged,
}: {
  project: ProjectView;
  /** jumlah ekosistem aktif (sub-garapan) di dalam project ini — 0 = gak tampil */
  ecoCount?: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newFreq, setNewFreq] = useState("daily");
  const [newOnchain, setNewOnchain] = useState(false);
  const [newChain, setNewChain] = useState("");
  const [newLink, setNewLink] = useState("");
  const [reffEdit, setReffEdit] = useState(false);
  const [reffDraft, setReffDraft] = useState("");
  const toast = useToast();

  const enr: Enrichment | null = project.enrichment ? JSON.parse(project.enrichment) : null;
  const rawFunding = (enr?.funding ?? "").trim();
  // cuma funding hasil riset web yang ditampilin — klaim grup gak disimpulkan
  const webFunding = Boolean(rawFunding) && !/^(unknown|n\/a|-|—)$/i.test(rawFunding);
  const fundValue = webFunding ? rawFunding : "";
  const hasFunding = Boolean(fundValue);
  const shortFunding = fundValue.length > 18 ? fundValue.slice(0, 18).replace(/\s+\S*$/, "") + "…" : fundValue;
  const type = TYPE[project.category] ?? TYPE.other;
  const rare = rarity(project, hasFunding);
  const pending = project.tasks.filter((t) => !t.doneToday);
  const [doneCount, totalCount] = project.doneRatio.split("/").map(Number);
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const tgeDays = project.tge_date ? daysUntil(project.tge_date) : null;

  async function toggle(task: TaskView) {
    setBusy(true);
    await fetch(`/api/tasks/${task.id}/toggle`, { method: "POST" });
    onChanged();
    setBusy(false);
    if (!task.doneToday) {
      toast(pending.length === 1 ? `${project.name} kelar semua hari ini.` : "Beres. Kartu TG ke-update.", "done");
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    await fetch(`/api/projects/${project.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTask, freq: newFreq, onchain: newOnchain, chain: newChain, link: newLink }),
    });
    setNewTask("");
    setNewOnchain(false);
    setNewChain("");
    setNewLink("");
    onChanged();
    toast("Task masuk.", "done");
  }

  async function saveReff(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referral: reffDraft.trim() }),
    });
    setReffEdit(false);
    onChanged();
    toast("Reff kesimpen.", "done");
  }

  async function delTask(taskId: number) {
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    onChanged();
    toast("Task kehapus.", "info");
  }

  // quest grinding discord — yang nambahin user sendiri (cuma beberapa garapan yang butuh)
  async function addGrind() {
    await fetch(`/api/projects/${project.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Grinding Discord min 3 jam", freq: "daily" }),
    });
    onChanged();
    toast("Quest grinding Discord masuk.", "done");
  }

  async function setStatus(status: string, msg: string) {    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onChanged();
    toast(msg, "done");
  }

  // warna kartu = status hari ini: hijau semua beres; pending itu kondisi normal — border netral,
  // merah cuma buat hal beneran error (hapus, gagal)
  const stateColor = pending.length === 0 ? "var(--done)" : null;

  return (
    <div
      className="animate-fade-up lift relative rounded-2xl border p-1.5"
      style={{
        borderColor: stateColor ? `color-mix(in srgb, ${stateColor} 42%, transparent)` : "var(--border-strong)",
        boxShadow:
          pending.length === 0 ? `0 0 28px color-mix(in srgb, var(--done) 12%, transparent)` : undefined,
      }}
    >
      {/* sheen ala holo pas kartu komplit */}
      {pending.length === 0 && (
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background: `radial-gradient(120% 55% at 18% 0%, color-mix(in srgb, var(--done) 15%, transparent), transparent 55%)`,
          }}
        />
      )}

      <div
        className="space-y-3 rounded-xl border bg-surface p-4"
        style={{ borderColor: stateColor ? `color-mix(in srgb, ${stateColor} 18%, transparent)` : undefined }}
      >
        {/* header ala kartu Pokemon: tipe + nama kiri, FUND ala HP kanan */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.22em]" style={{ color: type }}>
                {project.category}
              </p>
              {project.tier && (
                <span
                  className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-black"
                  style={{
                    color: TIER_COLOR[project.tier] ?? "var(--tier-c)",
                    background: `color-mix(in srgb, ${TIER_COLOR[project.tier] ?? "var(--tier-c)"} 14%, transparent)`,
                  }}
                  title="Tier dari engagement grup: banyak grup/pesan/reaksi yang bahas garapan ini"
                >
                  TIER {project.tier}
                </span>
              )}
              {/* status grinding: info nempel di baris label — gak usah badge gede dobel-dobel */}
              {(() => {
                const grind = project.tasks.some((t) => /grinding discord/i.test(t.title));
                const real =
                  project.tasks.some((t) => !/grinding discord|daily task|daily check-in|quest harian/i.test(t.title)) ||
                  project.category === "testnet" ||
                  project.category === "mainnet";
                if (grind && real) {
                  return (
                    <span className="font-mono text-[9px] font-black uppercase tracking-[0.22em] text-accent" title="Grinding Discord jalan buat poin ekstra — misi utama udah masuk">
                      + discord
                    </span>
                  );
                }
                if (grind && !real) {
                  return (
                    <span className="font-mono text-[9px] font-black uppercase tracking-[0.22em] text-warn" title="Belum ada misi beneran — grinding Discord dulu min 3 jam/hari">
                      grinding discord
                    </span>
                  );
                }
                return null;
              })()}
            </div>
            <a
              href={projectHref(project)}
              target={project.url ? "_blank" : undefined}
              rel={project.url ? "noreferrer noopener" : undefined}
              className="mt-0.5 block truncate text-base font-black leading-tight transition-colors hover:text-accent"
              title={project.url ? `Buka situs ${project.name} ↗` : "Buka detail garapan"}
            >
              {project.name}
            </a>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {project.chains && <Badge>{project.chains}</Badge>}
              {tgeDays !== null && (
                <Badge tone={tgeDays <= 14 ? "warn" : "neutral"}>TGE {tgeDays >= 0 ? `T-${tgeDays}` : "lewat"}</Badge>
              )}
              {project.oppSources.length > 0 && (
                <span className="flex flex-wrap items-center gap-1">
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
                </span>
              )}
              {/* ekosistem: selalu tampil di kartu mainnet/testnet — 0 = info kosong, n = jumlah ekosistem aktif; detail & task-nya di halaman Detail */}
              {!project.parent_id && (project.category === "mainnet" || project.category === "testnet") && (
                <a
                  href={`/project?id=${project.id}`}
                  className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                    ecoCount > 0
                      ? "border-border bg-surface-2 text-muted hover:border-accent/50 hover:text-accent"
                      : "border-dashed border-border text-faint hover:border-accent/50 hover:text-muted"
                  }`}
                  title={ecoCount > 0 ? `${ecoCount} ekosistem aktif di dalam garapan ini — buka Detail` : "Belum ada ekosistem — buka Detail buat nambahin"}
                >
                  {ecoCount} ekosistem
                </a>
              )}
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted">
              {pending.length === 0 ? (
                <span className="text-done">semua beres hari ini</span>
              ) : (
                <span className="text-warn">
                  {totalCount > 0 ? `${doneCount}/${totalCount} · ` : ""}
                  {pending.length} belum
                </span>
              )}
              {project.streakDays > 0 && (
                <>
                  {" "}
                  · <span className="text-warn">×{project.streakDays}h</span>
                </>
              )}
            </p>
          </div>
          <div
            className="shrink-0 text-right"
            title={hasFunding ? fundValue : "Funding belum ada info (gak disimpulkan dari klaim grup)"}
          >
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-faint">FUND</p>
            <p
              className="font-mono text-sm font-black leading-tight"
              style={{ color: hasFunding ? "var(--done)" : "var(--faint)" }}
            >
              {hasFunding ? shortFunding : "TBA"}
            </p>
          </div>
        </div>

      <ProgressBar pct={pct} tone={pct === 100 ? "done" : "accent"} />

      {/* daftar task */}
      <ul className="space-y-1.5">
        {project.tasks.map((t) => (
          <TaskRow key={t.id} task={t} busy={busy} onToggle={() => toggle(t)} onDelete={() => delTask(t.id)} />
        ))}
        {project.tasks.length === 0 && <li className="text-xs text-faint">Belum ada task, tambah di bawah.</li>}
      </ul>

      {/* tambah task — collapse biar kartu bersih */}
      <details className="text-xs">
        <summary className="w-fit cursor-pointer font-mono text-[11px] text-faint transition-colors hover:text-accent">
          + task baru
        </summary>
        <form onSubmit={addTask} className="mt-2 flex flex-wrap gap-1.5">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="nama task…"
            className="min-w-24 flex-1 rounded-md border border-border bg-bg px-2 py-1 outline-none placeholder:text-faint focus:border-accent"
          />
          <input
            value={newLink}
            onChange={(e) => setNewLink(e.target.value)}
            placeholder="link tugas (opsional)"
            className="min-w-32 flex-1 rounded-md border border-border bg-bg px-2 py-1 outline-none placeholder:text-faint focus:border-accent"
          />
          <select value={newFreq} onChange={(e) => setNewFreq(e.target.value)} className="rounded-md border border-border bg-bg px-1 py-1" aria-label="Frekuensi">
            {FREQS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-muted">
            <input type="checkbox" checked={newOnchain} onChange={(e) => setNewOnchain(e.target.checked)} className="accent-accent" />
            on-chain
          </label>
          {newOnchain && (
            <select value={newChain} onChange={(e) => setNewChain(e.target.value)} className="rounded-md border border-border bg-bg px-1 py-1" aria-label="Chain">
              <option value="">chain?</option>
              {Object.entries(CHAINS)
                .filter(([, m]) => m.etherscanId !== null)
                .map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.name}
                  </option>
                ))}
            </select>
          )}
          <button className="rounded-md border border-border px-2 py-1 transition-colors hover:bg-surface-2">add</button>
          <button
            type="button"
            onClick={addGrind}
            disabled={project.tasks.some((t) => /grinding discord/i.test(t.title))}
            className="rounded-md border border-warn/40 px-2 py-1 text-warn transition-colors hover:bg-warn/10 disabled:cursor-not-allowed disabled:opacity-40"
            title="Nambahin quest harian grinding Discord min 3 jam — buat garapan yang emang butuh"
          >
            + grind discord
          </button>
        </form>
      </details>

      {/* reff sendiri — row khusus: teken = salin, ✎ = ganti, kosong = taruh */}
      {reffEdit ? (
        <form onSubmit={saveReff} className="flex gap-1.5">
          <input
            value={reffDraft}
            onChange={(e) => setReffDraft(e.target.value)}
            placeholder="link / kode reff lo…"
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-xs outline-none placeholder:text-faint focus:border-accent"
          />
          <button className="rounded-md border border-border px-2 py-1 font-mono text-[11px] transition-colors hover:bg-surface-2">
            simpan
          </button>
          <button
            type="button"
            onClick={() => setReffEdit(false)}
            className="rounded-md border border-border px-2 py-1 font-mono text-[11px] text-faint transition-colors hover:bg-surface-2"
          >
            batal
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1.5">
          <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-widest text-faint">reff</span>
          {project.referral ? (
            <>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(project.referral);
                  } catch {
                    // http biasa (bukan localhost/https): clipboard API gak ada, fallback manual
                    const ta = document.createElement("textarea");
                    ta.value = project.referral;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand("copy");
                    ta.remove();
                  }
                  toast("Reff ke-copy. Tinggal paste.", "done");
                }}
                className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-muted transition-colors hover:text-accent"
                title={`${project.referral} — teken = salin`}
              >
                {project.referral}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReffDraft(project.referral);
                  setReffEdit(true);
                }}
                className="shrink-0 text-xs text-faint transition-colors hover:text-accent"
                title="Ganti reff"
                aria-label="Ganti reff"
              >
                ✎
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setReffDraft("");
                setReffEdit(true);
              }}
              className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-faint transition-colors hover:text-accent"
              title="Taruh link/kode referral lo di sini"
            >
              taruh reff lo di sini ＋
            </button>
          )}
        </div>
      )}

      {/* heatmap + info kartu diramping: satu baris kanan */}
      {project.tasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
          <Heatmap days={project.activeDays} weeks={10} cell={7} />
          <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-faint">
            <span>{project.activeDays.length} hari</span>
            <span>No.{String(project.id).padStart(3, "0")}</span>
            <span className="text-xs font-bold" style={{ color: rare.color }} title={rare.label}>
              {rare.sym}
            </span>
          </span>
        </div>
      )}

      {/* aksi project */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 font-mono text-[11px]">
        <button onClick={() => setStatus("done", "Selesai, keluar dari garapan.")} className="text-faint transition-colors hover:text-done" title="Tandai selesai (keluar dari garapan aktif)">
          ✓ selesai
        </button>
        <button onClick={() => setStatus("archived", "Ke arsip.")} className="text-faint transition-colors hover:text-text" title="Arsip (sembunyiin dari garapan, data tetap ada)">
          arsip
        </button>
        <button onClick={() => setConfirmDel(true)} className="text-faint transition-colors hover:text-danger" title="Hapus permanen (berita & misi ikut kehapus)">
          hapus
        </button>
        <a href={`/project?id=${project.id}`} className="ml-auto shrink-0 text-accent hover:underline" title="Buka detail project">
          Detail →
        </a>
      </div>
      </div>

      <ConfirmDialog
        open={confirmDel}
        title={`Hapus ${project.name}?`}
        description="Berita & misinya ikut kehapus permanen. Gak bisa dibalikin."
        onCancel={() => setConfirmDel(false)}
        onConfirm={async () => {
          setConfirmDel(false);
          await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
          onChanged();
          toast("Kehapus.", "danger");
        }}
      />
    </div>
  );
}