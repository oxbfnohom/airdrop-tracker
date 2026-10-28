import db from "./db";
import { parseLink } from "./parse";
import { enrichProject, llmConfigured } from "./enrich";
import { deepBackfillProject, dismissRelatedOpportunities } from "./news";
import type { Enrichment } from "./types";

export type OppAction = "adopt" | "dismiss";

/**
 * Inti aksi tombol Garap/Lewati — dipakai web API dan tombol inline Telegram
 * biar perilakunya persis sama.
 */
export async function actOnOpportunity(
  id: number,
  action: OppAction,
  nameOverride?: string,
): Promise<{ ok: boolean; status: number; project_id?: number; duplicate?: boolean; error?: string }> {
  const opp = db.prepare("SELECT * FROM opportunities WHERE id = ?").get(Number(id)) as
    | { id: number; title: string; name: string; url: string; body: string; tier: string; status: string; link: string }
    | undefined;
  if (!opp) return { ok: false, status: 404, error: "peluang gak ketemu" };

  if (action === "dismiss") {
    db.prepare("UPDATE opportunities SET status = 'dismissed' WHERE id = ?").run(opp.id);
    // skip one card = skip its twin reposts too
    dismissRelatedOpportunities(opp.name, 0, opp.id);
    return { ok: true, status: 200 };
  }

  if (action !== "adopt") return { ok: false, status: 400, error: "action harus adopt atau dismiss" };

  // build the project from the opportunity's best link (fall back to its message body)
  const target = opp.url || opp.link;
  const parsed = target ? parseLink(target) : null;
  const name = nameOverride || opp.name || parsed?.name || opp.title.slice(0, 60);

  const dup = db.prepare("SELECT id FROM projects WHERE name = ? AND status = 'active'").get(name) as
    | { id: number }
    | undefined;
  if (dup) {
    db.prepare("UPDATE opportunities SET status = 'adopted', project_id = ? WHERE id = ?").run(dup.id, opp.id);
    dismissRelatedOpportunities(name, dup.id, opp.id);
    return { ok: true, status: 200, project_id: dup.id, duplicate: true };
  }

  const info = db
    .prepare("INSERT INTO projects (name, url, platform, category, chains, notes) VALUES (?,?,?,?,?,?)")
    .run(
      name,
      parsed?.url ?? target ?? "",
      parsed?.platform ?? "other",
      parsed?.category ?? "testnet",
      parsed?.chains.join(",") ?? "",
      opp.body.slice(0, 500),
    );

  const projectId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO tasks (project_id, title, freq) VALUES (?, 'Daily task', 'daily')").run(projectId);
  db.prepare("UPDATE opportunities SET status = 'adopted', project_id = ? WHERE id = ?").run(projectId, opp.id);
  // adopt = it's a garapan now → its duplicate recommendation cards must go
  dismissRelatedOpportunities(name, projectId, opp.id);

  if (llmConfigured() && (parsed?.url || target)) {
    void enrichProject(parsed?.url ?? target!, name)
      .then((e: Enrichment | null) => {
        if (e) {
          db.prepare("UPDATE projects SET enrichment = ?, name = ? WHERE id = ? AND name = ?").run(
            JSON.stringify(e),
            e.name || name,
            projectId,
            name,
          );
        }
      })
      .then(() => deepBackfillProject(projectId))
      .then((r) => console.log(`[deep-backfill] adopted project ${projectId}: +${r.news} news, +${r.missions} missions`))
      .catch((e: unknown) => console.error("[enrich] adopt background error:", e));
  }

  return { ok: true, status: 201, project_id: projectId };
}
