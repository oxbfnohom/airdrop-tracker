import { NextResponse } from "next/server";
import db from "@/lib/db";
import { FREQS, type Freq } from "@/lib/types";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const title: string = body?.title;
  if (!title) return NextResponse.json({ error: "title wajib" }, { status: 400 });

  const freq: Freq = FREQS.includes(body?.freq) ? body.freq : "daily";
  const onchain = body?.onchain ? 1 : 0;
  const chain = onchain ? String(body?.chain ?? "") : "";
  // t.me = pesan grup → itu sumber, bukan halaman tugas
  let link = typeof body?.link === "string" && /^https?:\/\//.test(body.link.trim()) ? body.link.trim() : "";
  let source = typeof body?.source === "string" && /^https?:\/\/t\.me\//.test(body.source.trim()) ? body.source.trim() : "";
  if (/t\.me|telegram\.(me|org)/.test(link)) {
    if (!source) source = link;
    link = "";
  }

  const r = db
    .prepare("INSERT INTO tasks (project_id, title, freq, onchain, chain, link, source) VALUES (?,?,?,?,?,?,?)")
    .run(Number(id), title, freq, onchain, chain, link, source);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(r.lastInsertRowid));
  return NextResponse.json({ task }, { status: 201 });
}
