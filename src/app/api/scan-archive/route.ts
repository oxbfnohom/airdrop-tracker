import { NextResponse } from "next/server";
import { userbotConfigured, deepArchiveChats } from "@/lib/tgUser";

/** Pull long history (up to 2000 msgs per chat) from every joined chat. */
export async function POST() {
  if (!userbotConfigured()) {
    return NextResponse.json({ error: "userbot belum dikonfigurasi (TG_API_ID/HASH)" }, { status: 400 });
  }
  try {
    const scanned = await deepArchiveChats(2000);
    return NextResponse.json({ ok: true, scanned });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? "gagal" }, { status: 500 });
  }
}
