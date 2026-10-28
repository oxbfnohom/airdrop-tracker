import { NextResponse } from "next/server";
import db from "@/lib/db";
import { etherscanConfigured } from "@/lib/chain";
import { localDay } from "@/lib/types";

/** Status widget on-chain: cron jalan nggak, apa aja yang ke-watch & kecentang otomatis hari ini. */
export async function GET() {
  const lastRun =
    (
      db.prepare("SELECT value FROM settings WHERE key = 'job_ok:onchain'").get() as
        | { value: string }
        | undefined
    )?.value ?? null;

  const todayAuto = db
    .prepare(
      `SELECT p.name AS project, t.title, t.chain
       FROM task_logs tl
       JOIN tasks t ON t.id = tl.task_id
       JOIN projects p ON p.id = t.project_id
       WHERE tl.auto = 1 AND tl.day = ?
       ORDER BY p.name, t.title`,
    )
    .all(localDay()) as Array<{ project: string; title: string; chain: string }>;

  const watched = db
    .prepare(
      `SELECT t.chain AS chain, COUNT(*) AS c
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.onchain = 1 AND t.chain != '' AND p.status = 'active'
       GROUP BY t.chain`,
    )
    .all() as Array<{ chain: string; c: number }>;

  return NextResponse.json({ etherscan: etherscanConfigured(), lastRun, todayAuto, watched });
}
