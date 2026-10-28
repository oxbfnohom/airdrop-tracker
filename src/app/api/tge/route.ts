import { NextResponse } from "next/server";
import db from "@/lib/db";

/** TGE radar for farmed projects only — auto-purges non-portfolio & expired events. */
export async function GET() {
  // TGE+1 day passed → gone; also drop events whose project is no longer farmed
  db.prepare("DELETE FROM tge_events WHERE tge_date IS NOT NULL AND tge_date < date('now', 'localtime', '-1 day')").run();
  db.prepare(
    `DELETE FROM tge_events WHERE project_id IS NULL OR project_id NOT IN (SELECT id FROM projects WHERE status = 'active')`,
  ).run();

  const rows = db
    .prepare(
      `SELECT t.*, p.name AS project_name FROM tge_events t
       JOIN projects p ON p.id = t.project_id
       WHERE t.status = 'new' AND p.status = 'active'
       ORDER BY CASE WHEN t.tge_date IS NULL THEN 1 ELSE 0 END, t.tge_date ASC, t.id DESC
       LIMIT 100`,
    )
    .all();
  return NextResponse.json({ events: rows });
}

/** Dismiss a TGE event. */
export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
  db.prepare("UPDATE tge_events SET status = 'dismissed' WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
