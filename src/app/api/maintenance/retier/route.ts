import { NextResponse } from "next/server";
import db from "@/lib/db";
import { tgBuzzTier } from "@/lib/news";

/**
 * POST /api/maintenance/retier — satu kali: naikin tier peluang lama yang
 * ternyata rame di reply orang di semua grup (buzz grup > tier LLM).
 */
export async function POST() {
  const rows = db.prepare("SELECT id, name, tier FROM opportunities WHERE status = 'new'").all() as Array<{
    id: number;
    name: string;
    tier: string;
  }>;
  const RANK: Record<string, number> = { S: 3, A: 2, B: 1, C: 0 };
  const upd = db.prepare("UPDATE opportunities SET tier = ? WHERE id = ?");
  const bumped: Array<{ name: string; from: string; to: string }> = [];
  for (const r of rows) {
    const buzz = tgBuzzTier(r.name);
    if (buzz && RANK[buzz] > RANK[r.tier]) {
      upd.run(buzz, r.id);
      bumped.push({ name: r.name, from: r.tier, to: buzz });
    }
  }
  return NextResponse.json({ ok: true, checked: rows.length, bumped });
}
