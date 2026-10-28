import { NextResponse } from "next/server";
import db from "@/lib/db";
import { guessQuestType } from "@/lib/news";

interface OppRow {
  id: number;
  source: string;
  title: string;
  name: string;
  url: string;
  body: string;
  tier: string;
  reasons: string;
  effort: string;
  link: string;
  created_at: string;
  funding: string;
  tokenomics: string;
  x_followers: string;
  quest_type: string;
  adopted_name: string | null;
}

/** Nama yang dibersihin buat nge-grup repost antar grup: lowercase, tanah tanda baca/spasi ganda. */
function normKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

/**
 * Peluang di-GABUNG per project: satu kartu = satu garapan, semua grup yang bahas
 * jadi daftar link telegram. Funding diambil dari grup yang paling ngasih info.
 */
export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") === "1";
  const rows = db
    .prepare(
      `SELECT o.*, pr.name AS adopted_name FROM opportunities o
       LEFT JOIN projects pr ON pr.id = o.project_id
       ${all ? "" : "WHERE o.status = 'new'"}
       ORDER BY CASE o.tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, o.created_at DESC
       LIMIT 400`,
    )
    .all() as OppRow[];

  // peluang masuk per hari (7 hari terakhir) — buat grafik aktivitas, gak ngaruh ke kartu
  const perDay: Record<string, number> = {};
  for (const r of db
    .prepare(
      `SELECT substr(datetime(created_at, 'localtime'), 1, 10) d, COUNT(*) c FROM opportunities
       WHERE created_at >= datetime('now', '-7 days') GROUP BY d`,
    )
    .all() as Array<{ d: string; c: number }>) {
    perDay[r.d] = r.c;
  }

  // nama ramah grup: dari chat_title arsip (fallback: id chat)
  const chatTitles = new Map<string, string>();
  for (const r of db.prepare("SELECT DISTINCT chat, chat_title FROM tg_messages").all() as Array<{ chat: string; chat_title: string }>) {
    if (r.chat_title) chatTitles.set(r.chat, r.chat_title);
  }

  // grup berdasarkan nama normalisasi
  const groups = new Map<string, OppRow[]>();
  for (const o of rows) {
    const key = normKey(o.name || o.title.slice(0, 40));
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(o);
    groups.set(key, list);
  }

  const merged = [...groups.values()].map((list) => {
    // perwakilan kartu = tier terbaik, terbaru
    const best = [...list].sort(
      (a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || b.created_at.localeCompare(a.created_at),
    )[0];

    // sumber unik per grup — diurut dari share PERTAMA (paling awal), itu link asli yang kenal project ini
    const byChat = new Map<string, { group: string; link: string; date: string }>();
    for (const o of [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const chat = o.source.replace(/^tg:/, "");
      if (!byChat.has(chat)) {
        byChat.set(chat, { group: chatTitles.get(chat) || chat, link: o.link, date: o.created_at });
      }
    }
    const sources = [...byChat.values()];

    // funding/tokenomics/followers: ambil yang paling informatif dari semua grup
    const pick = (...vals: Array<string | null | undefined>) => vals.find((v) => v && v.trim() && v.trim().toLowerCase() !== "unknown") || "";

    // jenis garapan: dari kolom LLM kalau ada, selain itu ditebak dari teksnya
    const qType =
      list.find((o) => o.quest_type && o.quest_type !== "other")?.quest_type ??
      guessQuestType(`${best.title} ${best.body}`);

    return {
      ids: list.map((o) => o.id),
      name: best.name || best.title.slice(0, 60),
      title: best.title,
      body: best.body,
      url: best.url,
      tier: best.tier,
      effort: best.effort,
      reasons: best.reasons,
      questType: qType,
      funding: pick(...list.map((o) => o.funding)),
      tokenomics: pick(...list.map((o) => o.tokenomics)),
      x_followers: pick(...list.map((o) => o.x_followers)),
      sources,
      // link pertama yang bahas project ini — share asli, bisa diteken langsung
      firstShare: sources[0] ?? null,
      mentions: list.length,
      created_at: best.created_at,
      adopted_name: best.adopted_name,
    };
  });

  merged.sort(
    (a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || b.created_at.localeCompare(a.created_at),
  );

  return NextResponse.json({ opportunities: merged, perDay });
}
