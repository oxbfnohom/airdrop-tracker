import type { Enrichment } from "./types";
import { execFile } from "child_process";
import { llmChat, parseChatJson, llmConfigured } from "./llm";

export { llmConfigured };

/**
 * Grab page title/description as grounding context for the LLM.
 * Percobaan 1: fetch biasa (cepat). Kalau kena block/hasilnya tipis,
 * percobaan 2: Scrapling (python) — request dengan identitas Chrome asli,
 * tembus proteksi ringan kayak Cloudflare galxe.com tanpa browser berat.
 */
export async function fetchPageContext(url: string): Promise<string> {
  const plain = await plainContext(url).catch(() => "");
  if (plain && !isThin(plain)) return plain;
  const stealth = await scraplingContext(url).catch(() => "");
  return stealth || plain;
}

/** Konteks kegolong "tipis" = kemungkinan halaman block/challenge: gak ada judul & teksnya hampir kosong. */
function isThin(ctx: string): boolean {
  const title = /TITLE:\s*(.+)\n/.exec(ctx)?.[1]?.trim() ?? "";
  const text = /PAGE_TEXT:\s*([\s\S]*)$/.exec(ctx)?.[1]?.trim() ?? "";
  return !title && text.length < 100;
}

async function plainContext(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; airdrop-tracker/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const html = (await res.text()).slice(0, 50000);
    const title = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] ?? "";
    const desc =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^']{1,500})/i)?.[1] ??
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^']{1,500})/i)?.[1] ??
      "";
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 3000);
    return `TITLE: ${title}\nDESC: ${desc}\nPAGE_TEXT: ${text}`;
  } catch {
    return "";
  }
}

/** Fallback scraping pakai Scrapling — output format sama kayak plainContext. */
async function scraplingContext(url: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "python",
      ["scripts/fetch-context.py", url],
      { cwd: process.cwd(), timeout: 30000, windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => {
        const lines = String(stdout ?? "").split(/\r?\n/);
        const keep = lines.filter((l) => /^(TITLE|DESC|PAGE_TEXT):/.test(l));
        if (keep.length < 1) {
          if (err) console.error(`[scrapling] gagal: ${url} — ${String(err.message).slice(0, 100)}`);
          return resolve("");
        }
        console.log(`[scrapling] tembus: ${url}`);
        resolve(keep.join("\n"));
      },
    );
  });
}

const SYSTEM = `You are a crypto airdrop research assistant. Given a project link and optional page context,
return STRICT JSON only (no markdown, no commentary) with these keys:
name (official project name if identifiable, else ""), summary (1-2 sentences what the project is),
founder (known founder/team if public, else "unknown"),
funding (total raised + rounds if known, else "unknown"), investors (notable VCs, else "unknown"),
whitepaper (URL if found on page, else ""), docs (docs/gitbook URL, else ""),
x (x.com/twitter handle URL if found, else ""), telegram (official Telegram channel name or t.me URL if found, else ""),
tge_hint (any public TGE/mainnet timing signal, else ""),
risk (one-line honest assessment: e.g. "no public funding, anon team" or "backed by top VCs").
Use "unknown" or "" when unsure. Never invent facts.`;

export async function enrichProject(
  url: string,
  name: string,
): Promise<Enrichment | null> {
  if (!llmConfigured()) return null;
  const t0 = Date.now();
  try {
    const ctx = await fetchPageContext(url);
    console.log(`[enrich] ${name}: ctx=${ctx.length}b, ${Date.now() - t0}ms`);
    const text = await llmChat({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Link: ${url}\nParsed name: ${name}\n\n${ctx || "(page could not be fetched — use your knowledge of this project name)"}`,
        },
      ],
      max_tokens: 2000,
      json: true,
      timeoutMs: 120000,
    });
    if (!text) {
      console.error(`[enrich] LLM gagal (semua channel mati) — ${name}`);
      return null;
    }
    let raw = parseChatJson(text)?.content;
    console.log(`[enrich] ${name}: llm done in ${Date.now() - t0}ms, content=${raw ? raw.length + "ch" : "NONE"}`);
    if (!raw) {
      console.error("[enrich] LLM returned no content");
      return null;
    }
    // some gateways append SSE frames or stray text — isolate the JSON object
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      console.error("[enrich] no JSON object in content:", raw.slice(0, 300));
      return null;
    }
    raw = raw.slice(start, end + 1);
    try {
      return JSON.parse(raw) as Enrichment;
    } catch (e) {
      console.error("[enrich] JSON parse failed:", (e as Error).message, raw.slice(0, 300));
      return null;
    }
  } catch (e) {
    console.error("[enrich] fetch failed:", (e as Error).name, (e as Error).message);
    return null;
  }
}
