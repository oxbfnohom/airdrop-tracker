import { schedule } from "node-cron";
import db from "./db";
import { bumpGlobalStreak, runOnchainCheck, sendCheckinReminder, sendDailyDigest, updateProgressCard } from "./tracker";
import { pollNews, backfillPendingProjects, cleanupOldData } from "./news";
import { backupDb } from "./backup";
import { sendMessage, telegramConfigured } from "./telegram";
import { startBotPolling } from "./bot";

declare global {
  var __scheduler_started: boolean | undefined;
}

/** Never let a failed job kill the process — log and keep running. */
async function safe(name: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      `job_ok:${name}`,
      new Date().toISOString(),
    );
    const secs = Math.round((Date.now() - t0) / 1000);
    if (secs > 30) console.log(`[scheduler] ${name} took ${secs}s`);
  } catch (e) {
    console.error(`[scheduler] ${name} failed:`, e);
  }
}

export function startScheduler() {
  if (globalThis.__scheduler_started) return;
  globalThis.__scheduler_started = true;

  // last-resort net: a stray rejected promise must not crash the app on a VPS
  process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
  process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

  const tz = process.env.TZ || "Asia/Jakarta";

  // jaring pengaman: project yang kepotong restart server (belum ke-backfill) diproses ulang
  try {
    backfillPendingProjects();
  } catch (e) {
    console.error("[scheduler] backfill reconcile gagal:", e);
  }

  // jaring pengaman periodik: project aktif yang masih kosong (daily doang) di-retry tiap 15 menit
  schedule("*/15 * * * *", () => void safe("backfill", () => Promise.resolve(backfillPendingProjects(15 * 60 * 1000))), { timezone: tz });

  // morning digest 07:00
  schedule("0 7 * * *", () => void safe("digest", sendDailyDigest), { timezone: tz });

  // evening check-in reminder 20:00 (daily task belum done → warning streak, senyap kalau semua beres)
  schedule("0 20 * * *", () => void safe("checkin", sendCheckinReminder), { timezone: tz });

  // TGE reminder 09:00 — event yang jatuh HARI INI / BESOK (semua yang ke-track,
  // bukan cuma project sendiri) biar gak kelewat claim/snapshot
  schedule(
    "0 9 * * *",
    () =>
      void safe("tge_reminder", async () => {
        const rows = db
          .prepare(
            `SELECT name, tge_date, note, link, project_id FROM tge_events
             WHERE tge_date IN (date('now', 'localtime'), date('now', 'localtime', '+1 day'))`,
          )
          .all() as Array<{ name: string; tge_date: string; note: string; link: string; project_id: number | null }>;
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        for (const r of rows) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const d = Math.round((new Date(`${r.tge_date}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
          const msg =
            `⏰ <b>TGE ${d <= 0 ? "HARI INI" : "BESOK"}:</b> <b>${esc(r.name)}</b>` +
            (r.project_id ? " (garapan lo 🎯)" : "") +
            (r.note ? `\n${esc(r.note.slice(0, 200))}` : "") +
            (r.link ? `\n${r.link}` : "");
          await sendMessage(msg);
        }
      }),
    { timezone: tz },
  );

  // on-chain auto-check every 30 min — task nyentang sendiri kalau ada aktivitas, kartu progres ikut ke-update
  schedule(
    "*/30 * * * *",
    () =>
      void safe("onchain", async () => {
        const lines = await runOnchainCheck();
        if (lines.length > 0 && telegramConfigured()) {
          await sendMessage(lines.join("\n"));
          await updateProgressCard();
        }
        bumpGlobalStreak();
      }),
    { timezone: tz },
  );

  // news + opportunity poll every 5 min (finder groups + project channels + RSS)
  schedule("*/5 * * * *", () => void safe("news", pollNews), { timezone: tz });

  // cold DB backup 04:30 daily (DB = semua data + session userbot)
  schedule("30 4 * * *", () => void safe("backup", () => Promise.resolve(backupDb())), { timezone: tz });

  // retensi 6 bulan: berita/peluang/arsip lama dihapus tiap hari (setelah backup)
  schedule("35 4 * * *", () => void safe("retensi", () => Promise.resolve(cleanupOldData())), { timezone: tz });
  void safe("retensi", () => Promise.resolve(cleanupOldData())); // jalan sekali pas boot juga

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("scheduler_started", new Date().toISOString());
  console.log(`[scheduler] started (tz=${tz})`);

  // command bot (/garapan, /saran, /help) — long-poll di background
  startBotPolling();
}
