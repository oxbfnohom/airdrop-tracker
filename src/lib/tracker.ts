import db from "./db";
import { localDay, nameTokens, tickerTokens } from "./types";
import type { Category, Project, Task } from "./types";
import { checkChainActivity, etherscanConfigured } from "./chain";
import { editMessageText, sendAndGetId, sendMessage, telegramConfigured } from "./telegram";
import { guessQuestType, tgBuzzTier } from "./news";

export interface TaskView extends Task {
  doneToday: boolean;
  auto: boolean;
  streak: number;
}

export interface ProjectView extends Project {
  tasks: TaskView[];
  doneRatio: string;
  streakDays: number;
  tgChannel: string | null;
  /** Hari-hari (YYYY-MM-DD, ascending) dengan minimal satu task ter-log — buat heatmap aktivitas. */
  activeDays: string[];
  /** Tier konsensus terbaik dari semua grup finder yang bahas project ini. */
  tier: string | null;
  /** Funding + link sumber dari sinyal grup (kalau riset web gak nemu). */
  oppFunding: string | null;
  oppSources: Array<{ group: string; link: string }>;
}

/** Distinct days with any completed log for the project, used for streak + heatmap. */
function projectActiveDays(projectId: number): Set<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT tl.day FROM task_logs tl
       JOIN tasks t ON t.id = tl.task_id WHERE t.project_id = ?`,
    )
    .all(projectId) as Array<{ day: string }>;
  return new Set(rows.map((r) => r.day));
}

function calcStreak(days: Set<string>): number {
  let streak = 0;
  const d = new Date();
  // allow streak to survive if today not done yet (count from yesterday)
  if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);
  while (days.has(localDay(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function getProjectView(id: number): ProjectView | null {
  const views = getDashboard("active");
  const v = views.find((p) => p.id === id);
  if (v) return v;
  // also allow viewing archived/done projects
  const others = getDashboard("archived").find((p) => p.id === id) ?? getDashboard("done").find((p) => p.id === id);
  return others ?? null;
}

/** Anak ekosistem satu garapan (1 level doang) — urutan: yang belum beres duluan, abis itu nama. */
export function getEcosystemKids(id: number): ProjectView[] {
  return getDashboard("active")
    .filter((p) => p.parent_id === id)
    .sort(
      (a, b) =>
        Number(b.tasks.some((t) => !t.doneToday)) - Number(a.tasks.some((t) => !t.doneToday)) ||
        a.name.localeCompare(b.name),
    );
}

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

/** Nama normal buat nyocokin project ↔ peluang antar grup (sama kayak API opportunities). */
function oppKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

/** Tier terbaik + funding + sumber grup buat satu project, dari seluruh peluang yang bahas namanya. */
function oppConsensus(name: string): { tier: string | null; funding: string | null; sources: Array<{ group: string; link: string }> } {
  const key = oppKey(name);
  if (!key) return { tier: null, funding: null, sources: [] };
  const rows = db
    .prepare("SELECT name, tier, funding, source, link FROM opportunities WHERE name != ''")
    .all() as Array<{ name: string; tier: string; funding: string; source: string; link: string }>;

  // nama ramah grup dari arsip
  const chatTitles = new Map<string, string>();
  for (const r of db.prepare("SELECT DISTINCT chat, chat_title FROM tg_messages").all() as Array<{ chat: string; chat_title: string }>) {
    if (r.chat_title) chatTitles.set(r.chat, r.chat_title);
  }

  // token nama ≥4 huruf, atau ticker/alias yang sama (mis. "(DAC)" di dua nama beda gaya nulis)
  const myTokens = new Set(nameTokens(name).filter((t) => t.length >= 4));
  const myTickers = new Set(tickerTokens(name));
  const sameProject = (oppName: string) =>
    oppKey(oppName) === key ||
    nameTokens(oppName).some((t) => t.length >= 4 && myTokens.has(t)) ||
    tickerTokens(oppName).some((t) => myTickers.has(t));

  let tier: string | null = null;
  let funding: string | null = null;
  const byChat = new Map<string, { group: string; link: string }>();
  for (const r of rows) {
    if (!sameProject(r.name)) continue;
    if (TIER_RANK[r.tier] !== undefined && (tier === null || TIER_RANK[r.tier] < TIER_RANK[tier])) tier = r.tier;
    if (!funding && r.funding && r.funding.trim() && r.funding.trim().toLowerCase() !== "unknown") funding = r.funding.trim();
    const chat = r.source.replace(/^tg:/, "");
    if (!byChat.has(chat)) byChat.set(chat, { group: chatTitles.get(chat) || chat, link: r.link });
  }
  return { tier, funding, sources: [...byChat.values()] };
}

/**
 * Tier dari engagement grup: berapa banyak pesan nyebut project ini, di berapa grup,
 * plus reaksi emoji & reply yang kearsip. Garapan yang lagi rame dibahas → tier tinggi.
 * Nyocokin lewat token nama (ticker/alias), gak harus nama lengkap persis.
 */

export function getDashboard(status = "active"): ProjectView[] {
  const today = localDay();
  const projects = db
    .prepare("SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC")
    .all(status) as Project[];

  return projects.map((p) => {
    const tgChannel = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(`tg_channel:${p.id}`) as { value: string } | undefined;
    const tasks = db
      .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
      .all(p.id) as Task[];
    const days = projectActiveDays(p.id);

    const taskViews: TaskView[] = tasks.map((t) => {
      const log = db
        .prepare("SELECT * FROM task_logs WHERE task_id = ? AND day = ?")
        .get(t.id, today) as { auto: number } | undefined;
      // streak for a daily task = consecutive days this task was logged
      let tStreak = 0;
      if (t.freq === "daily") {
        const tDays = new Set(
          (db.prepare("SELECT day FROM task_logs WHERE task_id = ?").all(t.id) as Array<{ day: string }>).map((r) => r.day),
        );
        tStreak = calcStreak(tDays);
      }
      return {
        ...t,
        // "once" missions stay checked forever once completed (any day's log counts);
        // daily/weekly tasks reset naturally each new day
        doneToday: t.freq === "once" ? isTaskEverDone(t.id) : Boolean(log),
        auto: Boolean(log?.auto),
        streak: tStreak,
      };
    });

    // ratio = task beres hari ini / SEMUA task — sama kayak yang di-list di web & kartu TG
    const doneCount = taskViews.filter((t) => t.doneToday).length;
    const ratio = taskViews.length === 0 ? "—" : `${doneCount}/${taskViews.length}`;

    const consensus = oppConsensus(p.name);
    // tier final: dari engagement grup (banyak pesan/reaksi/grup yang bahas) —
    // kalau blom pernah dibahas grup, fallback ke tier konsensus peluang
    const tier = tgBuzzTier(p.name) ?? consensus.tier;
    return {
      ...p,
      tasks: taskViews,
      doneRatio: ratio,
      streakDays: calcStreak(days),
      tgChannel: tgChannel?.value ?? null,
      activeDays: [...days].sort(),
      tier,
      oppFunding: consensus.funding,
      oppSources: consensus.sources,
    };
  });
}

function isTaskEverDone(taskId: number): boolean {
  return Boolean(db.prepare("SELECT 1 FROM task_logs WHERE task_id = ? LIMIT 1").get(taskId));
}

export type GlobalStreak = { n: number; day: string };

/** Streak global = hari berturut-turut SEMUA garapan beres. Simpel: {n, day} di settings. */
export function getGlobalStreak(): GlobalStreak {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'streak_global'").get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value) as GlobalStreak;
  } catch {
    // settings korup → anggap belum ada
  }
  return { n: 0, day: "" };
}

/** Angka streak yang masih hidup: full kemarin/hari ini → n, selain itu 0 (putus). */
export function globalStreakAlive(): number {
  const s = getGlobalStreak();
  const yesterday = localDay(new Date(Date.now() - 86_400_000));
  return s.day === localDay() || s.day === yesterday ? s.n : 0;
}

/** Dipanggil tiap habis toggle / auto-check: semua garapan beres → streak maju, sekali per hari. */
export function bumpGlobalStreak(): void {
  try {
    const s = getGlobalStreak();
    const day = localDay();
    if (s.day === day) return; // hari ini udah kehitet

    const views = getDashboard("active");
    let totalDue = 0;
    for (const p of views) {
      const due = p.tasks.filter((t) => (t.freq === "once" ? !t.doneToday : true));
      totalDue += due.length;
      if (due.some((t) => !t.doneToday)) return; // masih ada yang belum
    }
    if (totalDue === 0) return; // gak ada garapan → gak dihitung

    const yesterday = localDay(new Date(Date.now() - 86_400_000));
    const n = s.day === yesterday ? s.n + 1 : 1;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('streak_global', ?)").run(JSON.stringify({ n, day }));
  } catch {
    // streak gagal gak boleh ganggu toggle
  }
}

export function toggleTask(taskId: number, day = localDay()): boolean {
  const task = db.prepare("SELECT freq FROM tasks WHERE id = ?").get(taskId) as { freq: string } | undefined;
  if (!task) return false;

  const existing = db.prepare("SELECT id FROM task_logs WHERE task_id = ? AND day = ?").get(taskId, day);
  if (existing) {
    // "once" missions: completion is permanent — unchecking is only allowed the same day
    if (task.freq === "once") {
      const everDone = db.prepare("SELECT COUNT(*) c FROM task_logs WHERE task_id = ? AND day != ?").get(taskId, day) as { c: number };
      if (everDone.c > 0) return true; // already permanently done — ignore
    }
    db.prepare("DELETE FROM task_logs WHERE id = ?").run((existing as { id: number }).id);
    return false;
  }
  db.prepare("INSERT INTO task_logs (task_id, day, auto) VALUES (?, ?, 0)").run(taskId, day);
  return true;
}

/** Auto-check on-chain tasks; logs them when activity detected. Returns report lines. */
export async function runOnchainCheck(day = localDay()): Promise<string[]> {
  const tasks = db
    .prepare("SELECT t.*, p.name as project FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.onchain = 1 AND t.chain != ''")
    .all() as Array<Task & { project: string }>;
  // EVM chains need an Etherscan key; Solana works keyless via public RPC
  const checkable = tasks.filter((t) => (t.chain === "solana" ? true : etherscanConfigured()));
  if (checkable.length === 0) return [];

  const perChain = new Map<string, boolean>();
  const lines: string[] = [];
  for (const t of checkable) {
    if (!perChain.has(t.chain)) {
      perChain.set(t.chain, await checkChainActivity(t.chain, day));
    }
    if (perChain.get(t.chain)) {
      const r = db
        .prepare("INSERT INTO task_logs (task_id, day, auto) VALUES (?, ?, 1) ON CONFLICT(task_id, day) DO NOTHING")
        .run(t.id, day);
      if (r.changes > 0) lines.push(`✅ ${t.project}: ${t.title} (auto, aktivitas on-chain terdeteksi)`);
    }
  }
  return lines;
}

/* ---------------- pretty Telegram formatting ---------------- */

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const CAT_ICON: Record<Category, string> = {
  testnet: "🧪",
  mainnet: "🚀",
  retro: "🕰️",
  quest: "📋",
  nft: "🖼️",
  social: "💬",
  other: "📌",
};

/** Nama hari+tanggal Indonesia, mis. "Kamis, 8 Okt 2026". */
function idDate(d = new Date()): string {
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

/** Escape karakter HTML supaya nama task/project yang mengandung &<> gak merusak pesan. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Tag induk buat anak ekosistem di pesan TG — biar keliatan garapan itu punya siapa. */
function parentTag(views: ProjectView[], p: ProjectView): string {
  if (!p.parent_id) return "";
  const parent = views.find((v) => v.id === p.parent_id);
  return parent ? ` <i>· dalam ${esc(parent.name)}</i>` : " <i>· ekosistem</i>";
}

/** Jenis garapan yang boleh punya ekosistem — susunan bertingkat TG khusus ini doang. */
const ECO_CATS = ["mainnet", "testnet"];

/** Kelompok garapan buat pesan TG: roots = induk (tanpa parent), anak ekosistem nyantol di bawah induknya.
 *  Urutan anak: yang belum beres duluan, abis itu nama. Susunan bertingkat KHUSUS mainnet/testnet —
 *  anak dari jenis lain (kalau suatu saat ada datanya) dirender standar sebagai root sendiri. */
function ecoGroups(views: ProjectView[]): Array<{ p: ProjectView; kids: ProjectView[] }> {
  const kidOrder = (a: ProjectView, b: ProjectView) =>
    Number(b.tasks.some((t) => !t.doneToday)) - Number(a.tasks.some((t) => !t.doneToday)) || a.name.localeCompare(b.name);
  const byParent = new Map<number, ProjectView[]>();
  for (const v of views) {
    if (!v.parent_id) continue;
    if (!ECO_CATS.includes(v.category)) continue; // bukan mainnet/testnet → gak dinest, dirender root
    const list = byParent.get(v.parent_id) ?? [];
    list.push(v);
    byParent.set(v.parent_id, list);
  }
  const nested = new Set<ProjectView>();
  for (const list of byParent.values()) for (const v of list) nested.add(v);
  return [
    // anak yang gak dinest (jenis lain / induknya udah gak aktif) → dirender sebagai root sendiri
    ...views.filter((v) => v.parent_id != null && !nested.has(v)).map((p) => ({ p, kids: [] as ProjectView[] })),
    ...views.filter((v) => !v.parent_id).map((p) => ({ p, kids: (byParent.get(p.id) ?? []).sort(kidOrder) })),
  ];
}

/** Baris header anak ekosistem: 🧩 Nama (🔥 streak) — dipake semua pesan TG biar konsisten. */
function kidHeader(k: ProjectView): string {
  return `🧩 <b>${esc(k.name)}</b>${k.streakDays > 0 ? ` 🔥 ${k.streakDays}h` : ""}`;
}

/** Progress bar 10 kotak: ▰▰▱▱▱▱▱▱▱▱ */
function bar(done: number, total: number): string {
  if (total <= 0) return "";
  const filled = Math.round((done / total) * 10);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, 10 - filled));
}

/** Ikon jenis garapan buat saran TG — nyambung sama label di web. */
const QTYPE_ICON: Record<string, string> = {
  testnet: "🧪",
  mainnet: "🚀",
  quest: "🎯",
  node: "🖥",
  nft: "🖼",
  waitlist: "📝",
  social: "📣",
  bot: "🤖",
  other: "✨",
};

const TIER_ICON: Record<string, string> = { S: "💎", A: "🥇", B: "🥈" };
const EFFORT_ID: Record<string, string> = { low: "ringan", medium: "sedang", high: "berat" };

interface SaranRow {
  name: string;
  title: string;
  url: string;
  link: string;
  tier: string;
  effort: string;
  reasons: string;
  quest_type: string;
  body: string;
}

/**
 * Item saran garapan — dipake digest pagi MAU command /saran.
 * Tiap item: tier, jenis garapan, effort, jumlah grup, link garapan + link pesan TG sumber.
 */
function saranItems(limit: number, since: string | null): string[] {
  const rows = db
    .prepare(
      `SELECT name, title, url, link, tier, effort, reasons, quest_type, body FROM opportunities
       WHERE status = 'new' AND tier IN ('S','A','B') ${since ? "AND created_at >= ?" : ""}
       ORDER BY CASE tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 ELSE 2 END, id DESC
       LIMIT 60`,
    )
    .all(...(since ? [since] : [])) as SaranRow[];

  // gabung repost antar grup: satu proyek = satu baris saran
  const seen = new Map<string, { row: SaranRow; mentions: number }>();
  for (const r of rows) {
    const key = (r.name || r.title.split("\n")[0]).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 40);
    const cur = seen.get(key);
    if (cur) cur.mentions++;
    else seen.set(key, { row: r, mentions: 1 });
  }

  return [...seen.values()].slice(0, limit).map(({ row: r, mentions }) => {
    const label = esc(r.name || r.title.split("\n")[0]);
    // kartu lama (sebelum kolom jenis ada / masih "other") ditebak ulang dari teksnya
    const qtype = r.quest_type && r.quest_type !== "other" ? r.quest_type : guessQuestType(`${r.title}\n${r.body}`);
    const chips = [
      QTYPE_ICON[qtype] ? `${QTYPE_ICON[qtype]} ${esc(qtype)}` : "",
      EFFORT_ID[r.effort] ? `⏱ ${EFFORT_ID[r.effort]}` : "",
      mentions > 1 ? `🗣 ${mentions} grup bahas` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    // dua pintu: link garapan (web) + pesan TG sumber — biar bisa langsung dicek
    const links = [
      r.url ? `🔗 <a href="${esc(r.url)}">link garapan</a>` : "",
      r.link ? `💬 <a href="${esc(r.link)}">pesan TG</a>` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const reason = r.reasons.trim().slice(0, 90);
    return [
      `${TIER_ICON[r.tier] ?? "🔹"} <b>${label}</b> — tier ${esc(r.tier)}`,
      chips,
      links,
      reason ? `<blockquote>↳ ${esc(reason)}${r.reasons.trim().length > 90 ? "…" : ""}</blockquote>` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
}

/** Saran buat command /saran — peluang terbaik sepanjang waktu (bukan cuma 24 jam). */
export function buildSaranText(): string {
  const items = saranItems(5, null);
  if (items.length === 0) {
    return "🔍 Belum ada saran yang numpuk. Scanner jalan tiap 5 menit — cek lagi nanti, atau buka web buat detail.";
  }
  return [
    "🧭 <b>SARAN GARAPAN TERBARU</b>",
    `📅 ${idDate()}`,
    "",
    items.join("\n\n"),
    "",
    "🔗 adopt & detail lengkap di web — ketik /garapan buat cek progres lo",
  ].join("\n");
}

/**
 * Garapan aktif + semua task LENGKAP buat command /garapan:
 * yang udah dikerjain tetep muncul (🟢), yang belum 🔴 — kayak kartu progres,
 * cuma plus footer summary + info TGE.
 */
export function buildGarapanPendingText(): string {
  const views = getDashboard("active");
  const lines: string[] = ["🔥 <b>GARAPAN LO HARI INI</b>", `📅 ${idDate()}`, ""];
  let pending = 0;
  let doneToday = 0;

  for (const { p, kids } of ecoGroups(views)) {
    if (p.tasks.length === 0 && !kids.some((k) => k.tasks.length > 0)) continue;
    const undone = p.tasks.filter((t) => !t.doneToday);
    doneToday += p.tasks.length - undone.length;
    pending += undone.length;
    const streak = p.streakDays > 0 ? ` · 🔥 ${p.streakDays} hari` : "";
    lines.push(`${CAT_ICON[p.category] ?? "📌"} <b>${esc(p.name)}</b>${parentTag(views, p)}`);
    lines.push(`<blockquote><code>${bar(p.tasks.length - undone.length, p.tasks.length)}</code> ${p.tasks.length - undone.length}/${p.tasks.length}${streak}`);
    for (const t of p.tasks) {
      lines.push(`${t.doneToday ? "🟢" : "🔴"} ${esc(t.title)}${t.freq === "weekly" ? " (mingguan)" : ""}`);
    }
    lines.push("</blockquote>");
    // anak ekosistem — rapat di bawah induknya
    for (const k of kids) {
      if (k.tasks.length === 0) {
        lines.push(`${kidHeader(k)} — <i>belum ada task</i>`);
        continue;
      }
      const ku = k.tasks.filter((t) => !t.doneToday);
      doneToday += k.tasks.length - ku.length;
      pending += ku.length;
      const kstreak = k.streakDays > 0 ? ` · 🔥 ${k.streakDays}h` : "";
      lines.push(kidHeader(k));
      lines.push(`<blockquote><code>${bar(k.tasks.length - ku.length, k.tasks.length)}</code> ${k.tasks.length - ku.length}/${k.tasks.length}${kstreak}`);
      for (const t of k.tasks) {
        lines.push(`${t.doneToday ? "🟢" : "🔴"} ${esc(t.title)}${t.freq === "weekly" ? " (mingguan)" : ""}`);
      }
      lines.push("</blockquote>");
    }
    lines.push(""); // pemisah antar garapan
  }

  if (pending === 0 && doneToday === 0) {
    lines.push("Belum ada garapan aktif — tambah dulu di web 😉", "");
  } else if (pending === 0) {
    lines.push("Semua beres hari ini, mantap 😎🎉", "");
  } else {
    lines.push(`✅ ${doneToday} task udah lo kerjain · 🔴 sisa ${pending} — gaskeun! 💪`, "");
  }

  const tl = tgeLine(views);
  if (tl) lines.push(tl);

  return lines.join("\n").trim();
}

/** Peluang 24 jam terakhir — buat bagian Saran di digest pagi. */
function opportunityLines(): string | null {
  const items = saranItems(5, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  if (items.length === 0) return null;
  return `🎯 <b>SARAN GARAPAN 24 JAM TERAKHIR</b>\n\n${items.join("\n\n")}\n\n🔗 detail + tombol garap di web`;
}

/** Morning digest of what is NOT done yet. */
export async function sendDailyDigest(): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const views = getDashboard("active");

  const lines: string[] = ["☀️ <b>GARAPAN HARI INI</b>", `📅 ${idDate()}`, ""];
  let pending = 0;

  for (const { p, kids } of ecoGroups(views)) {
    const due = p.tasks.filter((t) => t.freq !== "once" || !t.doneToday);
    const undone = due.filter((t) => !t.doneToday);
    const done = due.length - undone.length;
    const streak = p.streakDays > 0 ? ` · 🔥 ${p.streakDays} hari` : "";
    // induk tetep nampil kalau anaknya punya task — biar ekosistem tetap berurutan di bawahnya
    if (due.length === 0 && !kids.some((k) => k.tasks.length > 0)) continue;
    lines.push(`${CAT_ICON[p.category] ?? "📌"} <b>${esc(p.name)}</b>${parentTag(views, p)}`);
    if (due.length === 0) {
      lines.push("<blockquote>✅ Semua beres hari ini 👍</blockquote>");
    } else {
      lines.push(`<blockquote><code>${bar(done, due.length)}</code> ${done}/${due.length}${streak}`);
      for (const t of undone) {
        pending++;
        lines.push(`🔴 ${esc(t.title)}${t.freq === "weekly" ? " (mingguan)" : ""}`);
      }
      lines.push("</blockquote>");
    }
    // anak ekosistem — rapi berurut di bawah induknya (rapat, gak ada baris kosong nyisip)
    for (const k of kids) {
      if (k.tasks.length === 0) {
        lines.push(`${kidHeader(k)} — <i>belum ada task</i>`);
        continue;
      }
      const kundone = k.tasks.filter((t) => !t.doneToday);
      if (kundone.length > 0) {
        pending += kundone.length;
        lines.push(kidHeader(k));
        lines.push(`<blockquote>${kundone.map((t) => `🔴 ${esc(t.title)}${t.freq === "weekly" ? " (mingguan)" : ""}`).join("\n")}</blockquote>`);
      } else {
        lines.push(`${kidHeader(k)} — semua beres ✅`);
      }
    }
    lines.push(""); // pemisah antar garapan
  }

  if (pending === 0) lines.push("Semua beres, santai boss 😎", "");

  const tl = tgeLine(views);
  if (tl) lines.push(tl, "");
  const op = opportunityLines();
  if (op) lines.push(op, "");

  return sendMessage(lines.join("\n").trim());
}

/** Evening reminder — khusus daily task yang masih mentah + warning streak. Kirim cuma kalau ada yang belum done. */
export async function sendCheckinReminder(): Promise<boolean> {  if (!telegramConfigured()) return false;
  const views = getDashboard("active");
  const sections: string[] = [];
  let pending = 0;

  for (const { p, kids } of ecoGroups(views)) {
    const undone = p.tasks.filter((t) => t.freq === "daily" && !t.doneToday);
    const warn = p.streakDays > 0 ? ` — 🔥 streak ${p.streakDays} hari nyawa-nyama ikan!` : "";
    const kidParts: string[] = [];
    let kidPending = 0;
    for (const k of kids) {
      const ku = k.tasks.filter((t) => t.freq === "daily" && !t.doneToday);
      if (ku.length === 0) continue;
      kidPending += ku.length;
      kidParts.push(`${kidHeader(k)}\n<blockquote>${ku.map((t) => `🔴 ${esc(t.title)}`).join("\n")}</blockquote>`);
    }
    if (undone.length === 0 && kidPending === 0) continue;
    if (undone.length > 0) {
      sections.push(`${CAT_ICON[p.category] ?? "📌"} <b>${esc(p.name)}</b>${parentTag(views, p)}${warn}\n<blockquote>${undone.map((t) => `🔴 ${esc(t.title)}`).join("\n")}</blockquote>`);
    } else {
      sections.push(`${CAT_ICON[p.category] ?? "📌"} <b>${esc(p.name)}</b>${parentTag(views, p)}${warn}`);
    }
    sections.push(...kidParts);
    pending += undone.length + kidPending;
  }

  if (pending === 0) return false; // semua daily beres — jangan spam

  const footer = pending > 3 ? "Buruan gas, jangan nunda-nunda 😤" : "Dikit lagi beres, semangat 💪";
  return sendMessage(
    ["🌙 <b>PENGINGAT CHECK-IN</b>", `⏰ ${idDate()} · 4 jam lagi ganti hari`, "", ...sections, "", footer].join("\n").trim(),
  );
}

/**
 * Kartu progres harian: SATU pesan Telegram per hari, di-EDIT tiap task dicentang.
 * Centang pertama bikin pesan baru (message_id-nya disimpan di settings per tanggal),
 * centang berikutnya cuma nge-edit pesan itu — jadi gak banjir notif.
 */
export async function updateProgressCard(): Promise<void> {
  if (!telegramConfigured()) return;
  try {
    const text = buildProgressText();
    if (!text) return;

    const key = `progress_msg:${localDay()}`;
    const stored = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    const msgId = stored ? Number(stored.value) : null;

    // masih punya pesan hari ini → edit; gagal (kehapus/48 jam) → kirim baru
    if (msgId && (await editMessageText(msgId, text))) return;

    const newId = await sendAndGetId(text);
    if (newId) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, String(newId));
    }
  } catch {
    // notif gagal gak boleh bikin toggle error
  }
}

/** Snapshot semua garapan aktif: per project bar + sisa task, ditutup bar total. */
function buildProgressText(): string | null {
  const lines: string[] = ["📊 <b>PROGRES HARI INI</b>", `📅 ${idDate()}`, ""];
  let totalDue = 0;
  let totalDone = 0;
  const views = getDashboard("active");

  for (const { p, kids } of ecoGroups(views)) {
    // sama kayak kartu web: SEMUA task di-list — misi once yang udah done tetep muncul (🟢),
    // jadi isian kartu TG gak beda sama web; anak ekosistem rapi di bawah induknya
    const due = p.tasks;
    if (due.length === 0 && !kids.some((k) => k.tasks.length > 0)) continue;
    const undone = due.filter((t) => !t.doneToday);
    totalDue += due.length;
    totalDone += due.length - undone.length;

    const streak = p.streakDays > 0 ? ` · 🔥 ${p.streakDays} hari` : "";
    lines.push(`${CAT_ICON[p.category] ?? "📌"} <b>${esc(p.name)}</b>${parentTag(views, p)}${due.length === 0 ? " <i>(semua task-nya di ekosistem)</i>" : ""}`);
    if (due.length > 0) {
      lines.push(`<blockquote><code>${bar(due.length - undone.length, due.length)}</code> ${due.length - undone.length}/${due.length}${streak}`);
      for (const t of due) lines.push(`${t.doneToday ? "🟢" : "🔴"} ${esc(t.title)}${t.freq === "weekly" ? " (mingguan)" : ""}`);
      lines.push("</blockquote>");
    }
    for (const k of kids) {
      if (k.tasks.length === 0) continue;
      const ku = k.tasks.filter((t) => !t.doneToday);
      totalDue += k.tasks.length;
      totalDone += k.tasks.length - ku.length;
      lines.push(kidHeader(k));
      lines.push(`<blockquote><code>${bar(k.tasks.length - ku.length, k.tasks.length)}</code> ${k.tasks.length - ku.length}/${k.tasks.length}`);
      for (const t of k.tasks) lines.push(`${t.doneToday ? "🟢" : "🔴"} ${esc(t.title)}${t.freq === "weekly" ? " (mingguan)" : ""}`);
      lines.push("</blockquote>");
    }
    lines.push(""); // pemisah antar garapan
  }

  if (totalDue === 0) return null; // gak ada task harian → gak usah bikin kartu
  lines.push(
    totalDone === totalDue
      ? "🎉 <b>Semua beres!</b> Sisa nunggu digest besok 😎"
      : `<code>${bar(totalDone, totalDue)}</code> ${totalDone}/${totalDue} semua garapan`,
  );
  return lines.join("\n").trim();
}

function tgeLine(views: ProjectView[]): string | null {
  const soon = views
    .map((p) => ({ p, d: tgeInDays(p) }))
    // d >= 0: tanggal TGE yang udah kelewat (data basi) gak usah muncul jadi "-354 hari"
    .filter((x): x is { p: ProjectView; d: number } => x.d !== null && x.d >= 0 && x.d <= 14)
    .sort((a, b) => a.d - b.d);
  if (soon.length === 0) return null;
  return "⏰ <b>TGE dekat:</b> " + soon.map((x) => `${esc(x.p.name)} (${x.d} hari)`).join(", ");
}

export function tgeInDays(p: Project): number | null {
  if (!p.tge_date) return null;
  return Math.ceil(
    (new Date(`${p.tge_date}T00:00:00`).getTime() - new Date(`${localDay()}T00:00:00`).getTime()) / 86400000,
  );
}

