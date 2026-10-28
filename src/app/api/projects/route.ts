import { NextResponse } from "next/server";
import db from "@/lib/db";
import { parseLink, ecoNameFromUrl } from "@/lib/parse";
import { enrichProject, llmConfigured } from "@/lib/enrich";
import { getDashboard, globalStreakAlive } from "@/lib/tracker";
import { deepBackfillProject } from "@/lib/news";
import { sendMessage } from "@/lib/telegram";
import type { Enrichment } from "@/lib/types";

/** Escape HTML buat pesan TG biar nama/link berisi &<> gak merusak parse mode. */
function escTg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ALLOWED_STATUS = ["active", "archived", "done"];

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") ?? "active";
  return NextResponse.json({
    projects: getDashboard(ALLOWED_STATUS.includes(status) ? status : "active"),
    streak: globalStreakAlive(),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const url: string = body?.url;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url wajib diisi" }, { status: 400 });
  }

  const parsed = parseLink(url);
  const cat = body.category ?? parsed.category;

  // ekosistem: garapan di dalam garapan (khusus mainnet/testnet) — parent harus ada & bukan
  // anak sendiri (biar gak ada rantai tak terbatas)
  let parentId: number | null = null;
  let parentRow: { id: number; name: string; category: string; parent_id: number | null; chains: string } | null = null;
  if (body?.parent_id) {
    parentRow = (db
      .prepare("SELECT id, name, category, parent_id, chains FROM projects WHERE id = ?")
      .get(Number(body.parent_id)) ?? null) as { id: number; name: string; category: string; parent_id: number | null; chains: string } | null;
    if (!parentRow) return NextResponse.json({ error: "garapan induk gak ketemu" }, { status: 400 });
    if (parentRow.parent_id != null) return NextResponse.json({ error: "ekosistem cuma satu level — gak bisa di dalam ekosistem lain" }, { status: 400 });
    if (cat !== parentRow.category) return NextResponse.json({ error: `jenis ekosistem harus sama dengan induknya (${parentRow.category})` }, { status: 400 });
    parentId = parentRow.id;
  }

  // dedup: link yang sama gak boleh jadi project dobel (kuota LLM kebuang percuma)
  const normUrl = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const dupe = (
    db.prepare("SELECT id, name, url FROM projects").all() as Array<{ id: number; name: string; url: string }>
  ).find((p) => normUrl(p.url) === normUrl(parsed.url));
  if (dupe) {
    return NextResponse.json({ error: `project ini udah ada: ${dupe.name}`, projectId: dupe.id }, { status: 409 });
  }

  const defaultName =
    parentId !== null && parentRow ? ecoNameFromUrl(parsed.url, parentRow.name) : parsed.name;
  const finalName = (body.name as string) || defaultName;

  const info = db
    .prepare(
      "INSERT INTO projects (name, url, platform, category, chains, notes, parent_id) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      finalName,
      parsed.url,
      parsed.platform,
      cat,
      // anak warisi chain induknya biar konteksnya nyambung
      parentId !== null
        ? (db.prepare("SELECT chains FROM projects WHERE id = ?").get(Number(parentId)) as { chains: string }).chains
        : Array.isArray(body.chains) ? body.chains.join(",") : parsed.chains.join(","),
      (body.notes as string) || "",
      parentId,
    );

  const projectId = Number(info.lastInsertRowid);

  // TG: ekosistem baru dikabarin ke chat — biar ke-update di telegram juga (fire-and-forget)
  if (parentId !== null && parentRow) {
    void sendMessage(
      `🧩 <b>${escTg(finalName)}</b> masuk ekosistem <b>${escTg(parentRow.name)}</b>\n🔗 ${escTg(parsed.url)}`,
    );
  }

  // default daily task so the card is immediately useful
  db.prepare("INSERT INTO tasks (project_id, title, freq) VALUES (?, 'Daily task', 'daily')").run(projectId);

  if (llmConfigured() && parentId === null) {
    // fire-and-forget: enrich in background, card shows "researching" meanwhile.
    // ekosistem ditaruh manual oleh user — gak perlu diriset ulang namanya
    void enrichProject(parsed.url, finalName)
      .then((e: Enrichment | null) => {
        if (e) {
          db.prepare("UPDATE projects SET enrichment = ?, name = ? WHERE id = ? AND name = ?").run(
            JSON.stringify(e),
            e.name || finalName,
            projectId,
            finalName,
          );
        }
      })
      .then(() => backfillDeep(projectId))
      .catch((e: unknown) => console.error("[enrich] route background error:", e));
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  return NextResponse.json({ project }, { status: 201 });
}
async function backfillDeep(projectId: number) {
  try {
    const r = await deepBackfillProject(projectId);
    console.log(`[deep-backfill] project ${projectId}: +${r.news} news, +${r.missions} missions`);
  } catch (e) {
    console.error("[deep-backfill] failed:", e);
  }
}
