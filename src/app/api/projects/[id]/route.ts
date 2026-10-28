import { NextResponse } from "next/server";
import db from "@/lib/db";
import { dismissRelatedOpportunities } from "@/lib/news";
import { sendMessage } from "@/lib/telegram";

/** Escape HTML buat pesan TG. */
function escTg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ALLOWED = ["name", "url", "category", "chains", "status", "tge_date", "notes", "rss_url", "platform", "referral"];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of ALLOWED) {
    if (k in body) {
      sets.push(`${k} = ?`);
      vals.push(k === "chains" && Array.isArray(body[k]) ? body[k].join(",") : body[k]);
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: "tidak ada field valid" }, { status: 400 });

  vals.push(Number(id));
  db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(Number(id)) as { name: string; status: string; parent_id: number | null } | undefined;
  // no longer farmed → its recommendation cards must vanish with it
  if (project && project.status !== "active") {
    dismissRelatedOpportunities(project.name, Number(id));
    // ekosistem selesai/diarsip → TG ikut ke-update biar gak bingung kok hilang dari garapan
    if ("status" in body && project.parent_id !== null) {
      const parent = db.prepare("SELECT name FROM projects WHERE id = ?").get(Number(project.parent_id)) as { name: string } | undefined;
      const icon = project.status === "done" ? "✅" : "📦";
      void sendMessage(`${icon} <b>${escTg(project.name)}</b> <i>(ekosistem${parent ? ` dari ${escTg(parent.name)}` : ""})</i> ${project.status === "done" ? "selesai 🎉" : "diarsip"}`);
    }
  }
  return NextResponse.json({ project });
}

/** Bersihin semua data satu garapan (berita, TGE, task+log). */
function wipeProject(pid: number, name?: string) {
  // project deleted → its news, TGE events & recommendation cards go with it
  db.prepare("DELETE FROM news_items WHERE project_id = ?").run(pid);
  db.prepare("DELETE FROM tge_events WHERE project_id = ?").run(pid);
  db.prepare("DELETE FROM tasks WHERE project_id = ?").run(pid); // logs cascade via FK
  db.prepare("DELETE FROM projects WHERE id = ?").run(pid);
  if (name) dismissRelatedOpportunities(name, pid);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pid = Number(id);
  const project = db.prepare("SELECT name, parent_id FROM projects WHERE id = ?").get(pid) as { name: string; parent_id: number | null } | undefined;
  // garapan dihapus → ekosistem di dalamnya (sub-project) dan data setiap anak ikut kehapus
  const kids = db.prepare("SELECT id, name FROM projects WHERE parent_id = ?").all(pid) as Array<{ id: number; name: string }>;
  for (const k of kids) wipeProject(k.id, k.name);
  wipeProject(pid, project?.name);
  // sweep news orphaned by earlier project deletions (old ON DELETE SET NULL rows)
  db.prepare("DELETE FROM news_items WHERE project_id IS NULL").run();
  // TG: hapus ekosistem / garapan yang bawa ekosistem — biar ke-update di telegram
  if (project) {
    if (project.parent_id !== null) {
      void sendMessage(`🗑 <b>${escTg(project.name)}</b> <i>(ekosistem)</i> kehapus.`);
    } else if (kids.length > 0) {
      void sendMessage(`🗑 <b>${escTg(project.name)}</b> kehapus — ${kids.length} ekosistem ikut: <i>${escTg(kids.map((k) => k.name).join(", "))}</i>`);
    }
  }
  return NextResponse.json({ ok: true });
}
