import { NextResponse } from "next/server";
import db from "@/lib/db";

/** Set (or clear with empty string) the Telegram channel watched for this project. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const channel: string = (body?.channel ?? "").toString().trim().replace(/^https?:\/\/t\.me\/(s\/)?/, "").replace(/^@/, "");

  if (!channel) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(`tg_channel:${Number(id)}`);
  } else {
    if (!/^[A-Za-z0-9_]{4,64}$/.test(channel)) {
      return NextResponse.json({ error: "nama channel tidak valid" }, { status: 400 });
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`tg_channel:${Number(id)}`, channel);
  }
  return NextResponse.json({ ok: true, channel: channel || null });
}
