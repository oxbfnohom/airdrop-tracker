import { NextResponse } from "next/server";
import db from "@/lib/db";

/** Lists chats the userbot monitors — served from the tg_messages archive
 *  (kept fresh by the 5-min news poll), so opening the dashboard never
 *  triggers a full Telegram dialog scan just to show this count. */
export async function GET() {
  const chats = db
    .prepare("SELECT chat, chat_title FROM tg_messages GROUP BY chat ORDER BY chat_title")
    .all() as Array<{ chat: string; chat_title: string }>;
  return NextResponse.json({
    chats: chats.map((c) => ({ username: c.chat, title: c.chat_title })),
  });
}
