import { NextResponse } from "next/server";
import db from "@/lib/db";

/** GET /api/maintenance/llmusage — pemakaian LLM hari ini (counter dari lib/llm). */
export async function GET() {
  const day = new Date().toISOString().slice(0, 10);
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`llm_usage_${day}`) as
    | { value: string }
    | undefined;
  const usage = row ? (JSON.parse(row.value) as { calls: number; ok: number; fail: number }) : { calls: 0, ok: 0, fail: 0 };
  return NextResponse.json({
    hari: day,
    ...usage,
    catatan: `limit gratis OpenRouter: 50 panggilan/hari (1000/hari kalau pernah beli kredit $10 sekali). Pemakaian lo sekarang ~29/hari.`,
  });
}
