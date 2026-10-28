import { NextResponse } from "next/server";
import { sendMessage, telegramConfigured } from "@/lib/telegram";
import { buildGarapanPendingText, buildSaranText, sendCheckinReminder, sendDailyDigest } from "@/lib/tracker";

/** POST /api/telegram/test?kind=plain|digest|checkin|garapan|saran — kirim pesan test/preview ke chat lo. */
export async function POST(req: Request) {
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diisi di .env" }, { status: 400 });
  }
  const kind = new URL(req.url).searchParams.get("kind") ?? "plain";
  if (kind === "digest") {
    return NextResponse.json({ kind, ok: await sendDailyDigest() });
  }
  if (kind === "checkin") {
    const sent = await sendCheckinReminder();
    return NextResponse.json({
      kind,
      ok: sent,
      note: sent ? "" : "gak dikirim — semua daily task hari ini udah beres",
    });
  }
  // preview command bot — sama persis kayak balesan /garapan dan /saran
  if (kind === "garapan") {
    return NextResponse.json({ kind, ok: await sendMessage(buildGarapanPendingText()) });
  }
  if (kind === "saran") {
    return NextResponse.json({ kind, ok: await sendMessage(buildSaranText()) });
  }
  const ok = await sendMessage("✅ Test dari airdrop-tracker — bot nyambung!");
  return NextResponse.json({ kind, ok });
}
