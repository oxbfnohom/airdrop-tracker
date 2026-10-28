import { NextResponse } from "next/server";
import { getProjectView, getEcosystemKids } from "@/lib/tracker";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const view = getProjectView(Number(id));
  if (!view) return NextResponse.json({ error: "not found" }, { status: 404 });
  // detail page butuh 2 konteks ekstra: anak ekosistemnya + induknya (kalau ini yang jadi anak)
  const ecosystems = getEcosystemKids(Number(id));
  const parent = view.parent_id != null ? getProjectView(view.parent_id) : null;
  return NextResponse.json({ project: view, ecosystems, parent });
}
