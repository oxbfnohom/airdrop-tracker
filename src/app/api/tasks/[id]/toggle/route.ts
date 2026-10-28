import { NextResponse } from "next/server";
import { bumpGlobalStreak, toggleTask, updateProgressCard } from "@/lib/tracker";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const done = toggleTask(Number(id));
  bumpGlobalStreak();
  // satu kartu progres per hari di Telegram, di-edit tiap centang/uncentang — bukan pesan baru terus
  void updateProgressCard();
  return NextResponse.json({ taskId: Number(id), doneToday: done });
}
