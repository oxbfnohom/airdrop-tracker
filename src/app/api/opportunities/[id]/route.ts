import { NextResponse } from "next/server";
import { actOnOpportunity } from "@/lib/adoptOpp";

/** adopt = turn opportunity into a tracked project; dismiss = hide it. Inti logikanya di lib/adoptOpp. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "adopt" && action !== "dismiss") {
    return NextResponse.json({ error: "action harus adopt atau dismiss" }, { status: 400 });
  }
  const r = await actOnOpportunity(Number(id), action, typeof body?.name === "string" ? body.name : undefined);
  return NextResponse.json(
    { ok: r.ok, ...(r.project_id ? { project_id: r.project_id } : {}), ...(r.duplicate ? { duplicate: true } : {}) },
    { status: r.status },
  );
}
