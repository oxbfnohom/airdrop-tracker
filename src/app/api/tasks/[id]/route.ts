import { NextResponse } from "next/server";
import db from "@/lib/db";
import { FREQS, type Freq } from "@/lib/types";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 });

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(id)) as
    | { title: string; freq: string; onchain: number; chain: string }
    | undefined;
  if (!task) return NextResponse.json({ error: "task tidak ada" }, { status: 404 });

  const title = typeof body.title === "string" ? body.title : task.title;
  const freq: Freq = FREQS.includes(body.freq) ? body.freq : (task.freq as Freq);
  const onchain = typeof body.onchain === "boolean" ? (body.onchain ? 1 : 0) : task.onchain;
  const chain = body.chain !== undefined ? String(body.chain) : task.chain;

  db.prepare("UPDATE tasks SET title = ?, freq = ?, onchain = ?, chain = ? WHERE id = ?").run(
    title,
    freq,
    onchain,
    chain,
    Number(id),
  );
  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(id));
  return NextResponse.json({ task: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  db.prepare("DELETE FROM tasks WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}
