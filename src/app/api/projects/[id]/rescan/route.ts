import { NextResponse } from "next/server";
import { deepBackfillProject } from "@/lib/news";

/** Re-run deep scan for an existing project: full history + missions. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const projectId = Number(id);
  if (!projectId) return NextResponse.json({ error: "id wajib" }, { status: 400 });
  try {
    const r = await deepBackfillProject(projectId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? "gagal" }, { status: 500 });
  }
}
