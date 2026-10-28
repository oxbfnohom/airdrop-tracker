import { NextResponse } from "next/server";
import crypto from "node:crypto";

export async function POST(req: Request) {
  const pin = process.env.APP_PIN;
  if (!pin) return NextResponse.json({ ok: true, note: "auth disabled" });

  const body = await req.json().catch(() => null);
  if (body?.pin !== pin) return NextResponse.json({ error: "PIN salah" }, { status: 401 });

  const token = crypto.createHash("sha256").update(`at:${pin}`).digest("hex").slice(0, 32);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("at_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
