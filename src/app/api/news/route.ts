import { NextResponse } from "next/server";
import db from "@/lib/db";

/** News feed — only projects still actively farmed (archived/deleted → their news vanishes). */
export async function GET(req: Request) {
  const projectId = Number(new URL(req.url).searchParams.get("project_id") ?? 0);
  const items = projectId
    ? db
        .prepare(
          "SELECT n.*, p.name as project_name FROM news_items n LEFT JOIN projects p ON p.id = n.project_id WHERE n.project_id = ? ORDER BY n.id DESC LIMIT 100",
        )
        .all(projectId)
    : db
        .prepare(
          `SELECT n.*, p.name as project_name FROM news_items n
           JOIN projects p ON p.id = n.project_id AND p.status = 'active'
           ORDER BY n.id DESC LIMIT 100`,
        )
        .all();
  return NextResponse.json({ items });
}
