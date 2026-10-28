import { NextResponse } from "next/server";
import db from "@/lib/db";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  db.prepare("DELETE FROM wallets WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}
