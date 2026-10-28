import { NextResponse } from "next/server";
import db from "@/lib/db";
import { verifyClaims } from "@/lib/news";

/**
 * POST /api/maintenance/verifyclaims — satu kali: fact-check klaim funding/
 * tokenomics/followers di kartu peluang lama. Jalan di background (LLM pelan-pelan),
 * hasilnya langsung masuk DB — cek beberapa menit kemudian.
 */
export async function POST() {
  const rows = db
    .prepare(
      "SELECT id, name, url, link, body, funding, tokenomics, x_followers FROM opportunities WHERE status = 'new' AND (funding != '' OR tokenomics != '' OR x_followers != '')",
    )
    .all() as Array<{
      id: number;
      name: string;
      url: string;
      link: string;
      body: string;
      funding: string;
      tokenomics: string;
      x_followers: string;
    }>;

  const upd = db.prepare("UPDATE opportunities SET name = ?, funding = ?, tokenomics = ?, x_followers = ? WHERE id = ?");
  void (async () => {
    let n = 0;
    for (const r of rows) {
      const v = await verifyClaims(
        { name: r.name, body: r.body, link: r.url || r.link },
        { funding: r.funding, tokenomics: r.tokenomics, x_followers: r.x_followers },
      ).catch(() => null);
      if (v) {
        upd.run(v.name, v.funding, v.tokenomics, v.x_followers, r.id);
        n++;
      }
      await new Promise((res) => setTimeout(res, 1500)); // jangan nyedot LLM sekaligus
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('verifyclaims_done', ?)").run(
      JSON.stringify({ at: new Date().toISOString(), checked: rows.length, updated: n }),
    );
    console.log(`[verifyclaims] selesai: ${n}/${rows.length} kartu diverifikasi`);
  })();

  return NextResponse.json({ ok: true, queued: rows.length, note: "jalan di background — selesai dalam beberapa menit" });
}
