import { NextResponse } from "next/server";
import db from "@/lib/db";
import { relinkMissions } from "@/lib/news";

/**
 * POST /api/maintenance/relink — satu kali: isi link tugas + sumber t.me buat
 * misi lama yang dibikin sebelum fitur link (kolom masih kosong).
 */
export async function POST() {
  const ids = db.prepare("SELECT id, name FROM projects WHERE status = 'active'").all() as Array<{
    id: number;
    name: string;
  }>;
  const results: Array<{ id: number; name: string; linked: number }> = [];
  for (const p of ids) {
    const linked = await relinkMissions(p.id);
    results.push({ id: p.id, name: p.name, linked });
  }
  return NextResponse.json({ ok: true, results });
}
