import db from "./db";
import { GENERIC_WORDS, localDay, nameTokens } from "./types";
import { sendAndGetIdButtons, sendMessage, telegramConfigured } from "./telegram";
import { enrichProject, fetchPageContext, llmConfigured } from "./enrich";
import { llmChat, parseChatJson } from "./llm";
import { userbotConfigured, archiveJoinedChats, deepArchiveChats, downloadPhoto, type TgMessage } from "./tgUser";
import type { Enrichment } from "./types";

const KEYWORDS: Array<[string, RegExp]> = [
  ["tge", /\b(tge|token generation|genesis sale|launchpool)\b/i],
  ["snapshot", /\bsnapshot\b/i],
  ["mainnet", /\bmainnet( launch| beta| live| migration)?\b/i],
  ["listing", /\b(listing|lists? \$|will list|perpetual)\b/i],
  ["claim", /\b(claim|airdrop (is )?live|airdrop open|check eligibility)\b/i],
  ["deadline", /\b(deadline|last chance|ends? (in|on)|closes?)\b/i],
  ["tokenomics", /\b(tokenomics|token allocation|supply|allocation|emission|vesting|unlock schedule|airdrop %)\b/i],
  ["funding", /\b(raised|funding|seed round|series [abc]|investment|led by|strategic round)\b/i],
];

export interface NewsItemInput {
  title: string;
  link: string;
  body: string;
  source: string;
  date?: string | null;
}

/* ---------------- source: project RSS/blog (field rss_url) ---------------- */

async function fetchFeed(url: string): Promise<NewsItemInput[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; airdrop-tracker/1.0)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItemInput[] = [];
    const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/g) ?? [];
    for (const b of blocks.slice(0, 30)) {
      const pick = (tag: string) =>
        b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1]?.trim() ?? "";
      const link = pick("link").match(/href=["']([^"']+)/i)?.[1] ?? pick("link");
      const title = pick("title").replace(/<!\[CDATA\[|\]\]>/g, "");
      const body = pick("description").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "");
      const date = pick("pubDate") || pick("updated") || pick("published");
      if (title && link) items.push({ title, link, body: body.slice(0, 500), source: url, date });
    }
    return items;
  } catch {
    return [];
  }
}

/* ---------------- source: Telegram public channel preview ---------------- */

function parseTelegramPreview(html: string, channel: string): NewsItemInput[] {
  const items: NewsItemInput[] = [];
  // t.me/s/<channel> wraps each post in <div class="tgme_widget_message_wrap ...">
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const b of blocks.slice(-25)) {
    const text =
      b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
      b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)?.[1] ??
      "";
    if (!text) continue;
    const link = `https://t.me/${channel}/${(b.match(/data-post="[^/]+\/(\d+)"/) ?? [])[1] ?? ""}`;
    const plain = text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .trim();
    const datetime = b.match(/datetime="([^"]+)"/)?.[1] ?? null;
    // skip Telegram service messages (channel created/renamed etc.) — pure noise
    if (/^Channel (created|name was changed)/i.test(plain)) continue;
    items.push({ title: cleanTitle(plain).slice(0, 120), link, body: plain.slice(0, 700), source: `t.me/${channel}`, date: datetime });
  }
  return items;
}

async function fetchTelegramChannel(channel: string): Promise<NewsItemInput[]> {
  try {
    const res = await fetch(`https://t.me/s/${channel}`, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; airdrop-tracker/1.0)" },
    });
    if (!res.ok) return [];
    return parseTelegramPreview(await res.text(), channel);
  } catch {
    return [];
  }
}

/* ---------------- opportunity evaluation (finder/alpha groups) ---------------- */

/** Cheap keyword gate before spending an LLM call on a group message. */
const OPPO_GATE =
  /airdrop|testnet|quest|galxe|zealy|layer3|points?|faucet|farming|incentive|campaign|early ?access|whitelist|mainnet|tge|presale|interaction|task/i;

interface OpportunityVerdict {
  opportunity: boolean;
  name: string;
  link: string;
  tier: "S" | "A" | "B" | "C";
  effort: string;
  reasons: string;
  funding: string;
  tokenomics: string;
  x_followers: string;
  quest_type: string;
}

/** Judul berita bersih: link mentah dibuang (link sumber udah nempel di kartu), spasi dirapin. */
function cleanTitle(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pesan ringkasan harian grup (daily recap) — daftar isi, bukan berita; gak boleh masuk feed project. */
const RECAP_GATE = /daily\s+recap|rekap(\s|harian)|ringkasan\s+(hari|harian)|recap\s+-/i;

function firstUrl(text: string): string {
  return (
    text.match(/https?:\/\/[^\s<>"')\]]+/)?.[0]?.replace(/[.,)]+$/, "") ?? ""
  );
}

const QUEST_TYPES = ["testnet", "mainnet", "quest", "node", "nft", "waitlist", "social", "bot", "other"] as const;

function validQuestType(v: unknown): string | null {
  const t = String(v ?? "").toLowerCase().trim();
  return (QUEST_TYPES as readonly string[]).includes(t) ? t : null;
}

/** Jenis garapan dari teks pesan — fallback kalau LLM gak balikin quest_type. */
export function guessQuestType(text: string): string {
  const t = text.toLowerCase();
  if (/\bnode|\bvalidator\b/.test(t)) return "node";
  if (/testnet|devnet/.test(t)) return "testnet";
  if (/mainnet/.test(t)) return "mainnet";
  // WL/mint NFT banyak bertebaran — cek sebelum quest/waitlist biar "whitelist mission" gak nyasar
  if (/\bnft\b|freemint|\bwl\b|whitelist|\bmint\b|opensea|collection|reveal/.test(t)) return "nft";
  if (/galxe|zealy|layer3|crew3|questn|\bquest\b|\bmission\b|weekly task|season \d|week \d/.test(t)) return "quest";
  if (/waitlist|\bform\b|registrasi|\bdaftar\b|\bregister\b|sign.?up/.test(t)) return "waitlist";
  if (/telegram (mining )?bot|\bminer\b|tap.?to.?earn/.test(t)) return "bot";
  if (/follow|retweet|\brt\b|socials|\bkyc\b|connect.{0,20}(account|x\b|telegram|tg\b)|\blike\b|\bcomment\b/.test(t)) return "social";
  return "other";
}

async function llmEvaluateOpportunity(m: TgMessage): Promise<OpportunityVerdict | null> {
  if (!llmConfigured()) return null;
  try {
    const text = await llmChat({
      messages: [
        {
          role: "system",
          content:
            `You vet messages from crypto airdrop alpha/finder Telegram groups for an airdrop farmer. ` +
            `Decide if the message shares a FARMABLE opportunity (new testnet, quest platform campaign, points program, incentive task, etc.) — not just news/chatter/memes, not a project the farmer already farms. ` +
            `Weigh REAL project signals you know (not guesses): known funding/backers, known tokenomics incl. airdrop allocation, X (twitter) following. ` +
            `Tier S = clearly funded (known VCs/team), known tokenomics with meaningful airdrop allocation, strong X following, early stage / low effort. ` +
            `Tier A = most signals good (e.g. funded but tokenomics unclear, or great tokenomics but smaller following). ` +
            `Tier B = unproven, no known funding, crowded or late. Tier C = low value, high effort, or sketchy. ` +
            `quest_type = what kind of farming this is: "testnet" (incentivized testnet/devnet actions), "mainnet" (mainnet actions/points program), "nft" (NFT mint/whitelist/WL mission), "quest" (Galxe/Zealy/Layer3 style task platform), "node" (run node/validator), "waitlist" (waitlist/form registration), "social" (follow/RT/social tasks), "bot" (telegram mining bot), "other". ` +
            `IMPORTANT: funding/tokenomics/x_followers must be ONLY (a) stated in the message, or (b) well-established public facts you are CERTAIN about. If even slightly unsure → "unknown". NEVER invent or estimate numbers. ` +
            `IMPORTANT for NFT/WL/mint drops: do NOT give a high tier just because it is a whitelist/freemint — most NFT WL drops are LOW VALUE. Tier S/A for NFT only when the brand/artist is well-known or the collection has proven hype (big X following, active community); unknown collections → tier B or C. ` +
            `Return STRICT JSON: {opportunity: boolean, name: string (project/quest name, ""), link: string (best URL from the message), tier: "S"|"A"|"B"|"C", effort: "low"|"medium"|"high", quest_type: "testnet"|"mainnet"|"nft"|"quest"|"node"|"waitlist"|"social"|"bot"|"other", reasons: string (max 2 short sentences, Indonesian), funding: string (e.g. "$18.5M — a16z, Paradigm", or "unknown"), tokenomics: string (e.g. "5% supply buat airdrop", or "unknown"), x_followers: string (e.g. "120k", or "unknown")}${""}`,
        },
        { role: "user", content: `Group: ${m.chatTitle}\n\n${m.text}`.slice(0, 1500) },
      ],
      max_tokens: 2000,
      json: true,
      timeoutMs: 80000,
    });
    if (!text) return null;
    const raw = parseChatJson(text)?.content;
    if (!raw) return null;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const v = JSON.parse(raw.slice(start, end + 1)) as Partial<OpportunityVerdict>;
    if (!v.opportunity) return null;
    const sig = (s: unknown) => {
      const t = String(s ?? "").trim().slice(0, 120);
      return t && t.toLowerCase() !== "unknown" ? t : "";
    };
    // anti-nyasar: URL cuma dipercaya kalau beneran muncul di isi pesannya —
    // kalau LLM ngasih URL dari ingatannya sendiri, buang
    const rawLink = String(v.link ?? "").trim();
    const link = (rawLink.startsWith("http") && m.text.includes(rawLink) ? rawLink : "") || firstUrl(m.text);
    const verdict: OpportunityVerdict = {
      opportunity: true,
      name: String(v.name ?? "").slice(0, 80),
      link,
      tier: (["S", "A", "B", "C"].includes(String(v.tier)) ? v.tier : "C") as OpportunityVerdict["tier"],
      effort: String(v.effort ?? "").slice(0, 12),
      reasons: String(v.reasons ?? "").slice(0, 300),
      funding: sig(v.funding),
      tokenomics: sig(v.tokenomics),
      x_followers: sig(v.x_followers),
      quest_type: validQuestType(v.quest_type) ?? guessQuestType(m.text),
    };
    // tier atas bakal dipush ke TG — klaimnya wajib diverifikasi dulu
    if (verdict.tier === "S" || verdict.tier === "A") {
      const verified = await verifyClaims(
        { name: verdict.name, body: m.text, link: verdict.link },
        { funding: verdict.funding, tokenomics: verdict.tokenomics, x_followers: verdict.x_followers },
      ).catch(() => null);
      if (verified) {
        verdict.name = verified.name || verdict.name;
        verdict.funding = verified.funding;
        verdict.tokenomics = verified.tokenomics;
        verdict.x_followers = verified.x_followers;
      }
    }
    return verdict;
  } catch {
    return null;
  }
}

/**
 * Verdict peluang TANPA LLM — buat masa LLM mati/limit kuota biar tab Peluang
 * tetep ke-update (gak jadi beku). Tagihannya rendah: nama diambil dari host
 * link (bukan dikira-kira LLM), jenis dari keyword, tier selalu B. Pesan tanpa
 * link gak dipajang — tanpa LLM, halaman tujuan adalah bahan mutlak.
 */
function heuristicVerdict(m: TgMessage): OpportunityVerdict | null {
  const link = firstUrl(m.text);
  if (!link || /t\.me\/|telegram\.me\/|x\.com\/|twitter\.com\/|youtu/i.test(link)) return null;
  let name = "";
  try {
    const host = new URL(link).hostname.replace(/^www\.|^app\.|^portal\.|^testnet\.|^earn\./i, "");
    const root = (host.split(".").slice(-2, -1)[0] ?? "").toLowerCase();
    // host yang kepanjangan acak (hash/uuid) gak bisa jadi nama
    if (root.length >= 3 && /[a-z]/.test(root) && !/^[0-9a-f]{12,}$/.test(root)) {
      name = root.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch {
    /* link rusak — biar kosong */
  }
  if (!name) {
    // fallback teks: frasa kapital tepat sebelum kata kunci — "Elysium testnet live"
    const km = m.text.match(
      /\b([A-Z][A-Za-z0-9]{2,20}(?:\s+[A-Z][A-Za-z0-9]{2,20})?)\s+(?:airdrop|testnet|mainnet|quest|WL\b|whitelist|waitlist|campaign|points?|incentiv)/,
    );
    if (km) name = km[1];
  }
  if (!name) return null;
  return {
    opportunity: true,
    name: name.slice(0, 80),
    link,
    tier: "B",
    effort: "",
    reasons: "Saran otomatis dari keyword & link grup (tanpa LLM) — riset lu sendiri dulu.",
    funding: "",
    tokenomics: "",
    x_followers: "",
    quest_type: guessQuestType(m.text),
  };
}

/**
 * Fact-check klaim peluang (funding/tokenomics/followers/nama) sebelum dipajang.
 * Grounding = isi pesan grup + konten halaman garapan (di-fetch), terus LLM disuruh
 * konfirmasi — gak konfirmasi = "unknown". Lebih baik kosong daripada data nyasar.
 */
export async function verifyClaims(
  src: { name: string; body: string; link: string },
  claims: { funding: string; tokenomics: string; x_followers: string },
): Promise<{ name: string; funding: string; tokenomics: string; x_followers: string } | null> {
  if (!llmConfigured()) return null;
  if (!claims.funding && !claims.tokenomics && !claims.x_followers) return { name: src.name, ...claims };
  let ctx = "";
  if (src.link && /^https?:\/\//.test(src.link) && !src.link.includes("t.me/")) {
    ctx = await fetchPageContext(src.link).catch(() => "");
  }
  try {
    const text = await llmChat({
      messages: [
        {
          role: "system",
          content:
            `You are a STRICT fact-checker for crypto airdrop research. Verify claims about a project using (a) the finder-group message and (b) fetched page context when available, plus (c) well-established public knowledge you are CERTAIN about. ` +
            `A claim is confirmed only when clearly supported. If not confirmed → "unknown". NEVER invent or estimate numbers. ` +
            `Also fix the project name if the context reveals the official name differs. ` +
            `Return STRICT JSON: {name: string, funding: string (e.g. "$18.5M — a16z" or "unknown"), tokenomics: string (e.g. "5% supply buat airdrop" or "unknown"), x_followers: string (e.g. "120k" or "unknown")}`,
        },
        {
          role: "user",
          content:
            `Current claims to verify:\nname: ${src.name}\nfunding: ${claims.funding || "unknown"}\ntokenomics: ${claims.tokenomics || "unknown"}\nx_followers: ${claims.x_followers || "unknown"}\n\n` +
            `Finder-group message:\n${src.body.slice(0, 700)}\n\n` +
            `Fetched page context:\n${ctx.slice(0, 3000) || "(page unavailable)"}`,
        },
      ],
      max_tokens: 2000,
      json: true,
      timeoutMs: 80000,
    });
    if (!text) return null;
    const raw = parseChatJson(text)?.content;
    if (!raw) return null;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const r = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const clean = (s: unknown) => {
      const t = String(s ?? "").trim().slice(0, 120);
      return t && t.toLowerCase() !== "unknown" ? t : "";
    };
    return {
      name: clean(r.name) || src.name,
      funding: clean(r.funding),
      tokenomics: clean(r.tokenomics),
      x_followers: clean(r.x_followers),
    };
  } catch {
    return null;
  }
}

/** lowercase alphanumerics only — for fuzzy project-name comparison */
export function normName(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** true when both names are clearly the same project (containment either way) */
function sameProjectName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (x.length < 4 || y.length < 4) return x.length >= 4 && x === y;
  return x.includes(y) || y.includes(x);
}

/**
 * Kill every recommendation card that belongs to one project: the linked card
 * itself (adopted → dismissed so it never resurfaces) plus any still-'new'
 * card about the same project (finder groups repost the same thing often).
 * Called on adopt / skip / archive / delete — the project must NOT linger in
 * the recommendations tab after the user acted on it.
 */
export function dismissRelatedOpportunities(projectName: string, projectId: number, exceptId?: number): void {
  const pid = Number(projectId) || 0;
  const rows = db
    .prepare("SELECT id, name, project_id, status FROM opportunities")
    .all() as { id: number; name: string; project_id: number | null; status: string }[];
  for (const o of rows) {
    if (exceptId && o.id === exceptId) continue;
    const linked = pid > 0 && o.project_id === pid;
    if ((linked && o.status !== "dismissed") || (o.status === "new" && sameProjectName(o.name, projectName))) {
      db.prepare("UPDATE opportunities SET status = 'dismissed' WHERE id = ?").run(o.id);
    }
  }
}

function storeOpportunity(m: TgMessage, v: OpportunityVerdict): number | null {
  const dup = db.prepare("SELECT 1 FROM opportunities WHERE link = ?").get(m.link);
  if (dup) return null;
  // one card per project: finder groups repost the same campaign many times,
  // and an already-farmed project is not a "recommendation" at all
  const vName = normName(v.name);
  if (vName.length >= 4) {
    const newOnes = db.prepare("SELECT name FROM opportunities WHERE status = 'new'").all() as { name: string }[];
    if (newOnes.some((o) => normName(o.name) === vName)) return null;
    const active = db.prepare("SELECT name FROM projects WHERE status = 'active'").all() as { name: string }[];
    if (active.some((p) => sameProjectName(p.name, v.name))) return null;
    // the user already skipped/deleted this project once — do not re-recommend it
    const decided = db
      .prepare("SELECT name FROM opportunities WHERE status != 'new'")
      .all() as { name: string }[];
    if (decided.some((o) => sameProjectName(o.name, v.name))) return null;
  }
  const info = db
    .prepare(
      "INSERT INTO opportunities (source, title, name, url, body, tier, reasons, effort, link, funding, tokenomics, x_followers, quest_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(`tg:${m.chat}`, m.text.slice(0, 120), v.name, v.link || firstUrl(m.text), m.text.slice(0, 700), v.quest_type === "nft" ? nftTierCap(combineTier(v.tier, v.name), v.name, v.x_followers) : combineTier(v.tier, v.name), v.reasons, v.effort, m.link, v.funding, v.tokenomics, v.x_followers, v.quest_type);
  return Number(info.lastInsertRowid);
}

/* ---------------- smart project matching ---------------- */

interface MatchHints {
  name: string;
  tokens: string[];
  handle: string | null;
  channel: string | null;
  domain: string | null;
  pathKey: string | null; // id quest unik (galxe dll) — share link = share project
}

function buildHints(p: ProjectRow, channel?: string | null): MatchHints {
  let host: string | null = null;
  let path = "";
  try {
    const u = new URL(p.url?.startsWith("http") ? p.url : `https://${p.url}`);
    host = u.hostname.replace(/^www\./, "").toLowerCase();
    path = u.pathname.replace(/\/+$/, "");
  } catch {
    host = null;
  }
  let handle: string | null = null;
  let chan: string | null = channel ?? null;
  try {
    const enr: Enrichment | null = p.enrichment ? JSON.parse(p.enrichment) : null;
    handle = enr?.x?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i)?.[1]?.toLowerCase() ?? null;
    if (!chan && enr?.telegram) {
      chan =
        enr.telegram.replace(/https?:\/\/t\.me\/(s\/)?/i, "").replace(/^@/, "").split("/")[0].toLowerCase() || null;
    }
  } catch {
    // enrichment json broken — hints stay null
  }
  const { domain, pathKey } = urlIdentity(host, path);
  return {
    name: p.name.trim(),
    tokens: nameTokens(p.name),
    handle,
    channel: chan,
    domain,
    pathKey,
  };
}

// host sosial/shortener/platform generik — BUKAN identitas project. Kalau domain
// hint-nya "t.me" atau "galxe.com", SEMUA pesan yang punya link t.me/galxe apapun
// bakal nyasar ke project itu (bug: ElyonChain kebacain misi "Titan Exchange").
const GENERIC_HOSTS = new Set([
  "t.me", "telegram.me", "telegram.dog", "x.com", "twitter.com", "linktr.ee",
  "discord.gg", "discord.com", "youtube.com", "youtu.be", "google.com",
  "docs.google.com", "forms.gle", "bit.ly", "cutt.ly", "github.com", "medium.com",
  "galxe.com", "zealy.io", "layer3.xyz", "intract.io", "carv.io", "taskon.xyz",
  "questn.com", "owlto.finance",
]);
// segmen pertama path t.me yang bukan nama chat
const TG_RESERVED = new Set(["joinchat", "proxy", "share", "addstickers", "iv", "c"]);

/**
 * Identitas dari url project:
 * - host biasa → domain inti (train.actionmodel.com → actionmodel.com)
 * - t.me/<chat> → "t.me/<chat>" (channel/bot resmi project = identitas sah)
 * - t.me/<chat>/<id pesan> → null — itu cuma pesan sumber di grup finder,
 *   isinya bisa airdrop project LAIN, gak boleh dipakai nyocokin apa pun.
 * - host platform (galxe/dll) → domain null, tapi segmen path yang kayak
 *   id quest unik jadi pathKey: pesan yang share link quest sama = project sama.
 * - host sosial/shortener generik → null.
 */
function urlIdentity(host: string | null, path: string): { domain: string | null; pathKey: string | null } {
  if (!host) return { domain: null, pathKey: null };
  if (host === "t.me" || host === "telegram.me" || host === "telegram.dog") {
    const seg = path.split("/").filter(Boolean);
    if (seg.length === 1 && /^[A-Za-z0-9_]{3,32}$/.test(seg[0]) && !TG_RESERVED.has(seg[0].toLowerCase())) {
      return { domain: `t.me/${seg[0].toLowerCase()}`, pathKey: null };
    }
    return { domain: null, pathKey: null }; // permalink pesan / invite hash — bukan identitas
  }
  const base = host.replace(/^app\.|^testnet\.|^dev\.|^portal\.|^quest\.|^dashboard\.|^airdrop\.|^earn\./, "");
  if (GENERIC_HOSTS.has(host) || GENERIC_HOSTS.has(base)) {
    const id = path
      .split("/")
      .filter((s) => s.length >= 8 && /[a-z]/i.test(s) && /\d/.test(s))
      .sort((a, b) => b.length - a.length)[0];
    return { domain: null, pathKey: id ? id.toLowerCase() : null };
  }
  return { domain: base.includes(".") ? base : host, pathKey: null };
}

/** Does this text mention portfolio project p? Full name OR any name token (ticker/alias). */
function mentionsProject(text: string, h: MatchHints): boolean {
  const t = text.toLowerCase();
  if (h.name.length > 2 && new RegExp(`\\b${h.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) return true;
  // token nama (ticker/alias dari kurung): "DAC", "dachain" — pesan grup jarang nulis nama lengkap.
  // Kata generik ("model" dari "Action Model") GAK BOLEH jadi penanda: "Trezor Model T"
  // pernah nyangkut ke Action Model gara-gara ini.
  for (const tok of h.tokens) {
    if (GENERIC_WORDS.has(tok)) continue;
    if (new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) return true;
  }
  if (h.handle && t.includes(`@${h.handle}`)) return true;
  if (h.channel && t.includes(`@${h.channel}`)) return true;
  if (h.domain && t.includes(h.domain)) return true;
  if (h.pathKey && t.includes(h.pathKey)) return true;
  return false;
}

/* ---------------- TGE radar ---------------- */

/** Detects finder-confirmed TGE/launch-date announcements in a message. */
async function llmExtractTge(text: string): Promise<{ name: string; date: string | null; note: string } | null> {
  if (!llmConfigured()) return null;
  try {
    const text2 = await llmChat({
      messages: [
        {
          role: "system",
          content:
            `You scan crypto airdrop Telegram groups for CONFIRMED TGE / token generation event / listing-date announcements. ` +
            `Only report if the message clearly states a project's TGE/token launch/listing date or a very specific window ("TGE 12 Juni", "listing besok", "snapshot 3 hari lagi"). ` +
            `Rumors ("kemungkinan Q3") do NOT count. Return STRICT JSON: {tge: boolean, name: string (project name), date: "YYYY-MM-DD" (compute from relative dates using today=${new Date().toISOString().slice(0, 10)}), note: string (short, Indonesian)}`,
        },
        { role: "user", content: text.slice(0, 1500) },
      ],
      max_tokens: 1500,
      json: true,
      timeoutMs: 70000,
    });
    if (!text2) return null;
    const raw = parseChatJson(text2)?.content;
    if (!raw) return null;
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s === -1 || e <= s) return null;
    const v = JSON.parse(raw.slice(s, e + 1));
    if (!v.tge || !v.name) return null;
    return {
      name: String(v.name).slice(0, 80),
      date: typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null,
      note: String(v.note ?? "").slice(0, 200),
    };
  } catch {
    return null;
  }
}

/* ---------------- TGE radar TANPA LLM: parsi tanggal dari teks pesan ---------------- */

const TGE_MONTHS: Record<string, number> = {
  januari: 0, january: 0, jan: 0,
  februari: 1, february: 1, feb: 1,
  maret: 2, march: 2, mar: 2,
  april: 3, apr: 3,
  mei: 4, may: 4,
  juni: 5, june: 5, jun: 5,
  juli: 6, july: 6, jul: 6,
  agustus: 7, august: 7, aug: 7, agust: 7, agu: 7,
  september: 8, sept: 8, sep: 8,
  oktober: 9, october: 9, okt: 9, oct: 9,
  november: 10, nov: 10,
  desember: 11, december: 11, des: 11, dec: 11,
};

/** Kalimat yang kena keyword TGE/listing/snapshot/launch — tempat tanggal dicari. */
function tgeSentence(text: string): string | null {
  for (const s of text.split(/(?<=[.!\n])\s+/)) {
    if (/\btge\b|token generation|\blisting\b|\bsnapshot\b|\blaunch(?:ing| date)?\b/i.test(s) && /\d|besok|har\s?ini|today|tomorrow/i.test(s)) {
      return s;
    }
  }
  return null;
}

/**
 * Ekstraksi tanggal TGE/listing/snapshot TANPA LLM. Yang dipercaya: hari eksplisit
 * ("TGE 12 juni 2026", "listing June 12"), relatif ("listing besok", "snapshot 3 hari lagi",
 * "TGE hari ini"). Rumor/dugaan ("kemungkinan", "Q3/kuartal") gak dipercaya — gak ada
 * tanggal pasti = gak ada radar event.
 */
export function heuristicTgeDate(text: string): { date: string; note: string } | null {
  const sent = tgeSentence(text);
  if (!sent) return null;
  const t = sent.toLowerCase();
  if (/kemungkinan|maybe|estimate|guidance|q\s?[1-4]\b|kuartal|rumor|menjelang akhir/.test(t)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();

  // 1) relatif: "3 hari lagi", "besok", "hari ini"
  const rel = sent.match(/\b(\d{1,2})\s*hari\s*(?:lagi|ke ?depan)\b/i);
  let offset: number | null = rel ? Number(rel[1]) : null;
  if (offset === null && /\bbesok\b|tomorrow/i.test(t)) offset = 1;
  if (offset === null && /\bhar\s?ini\b|today|\bmalam ini\b/i.test(t)) offset = 0;
  if (offset !== null && offset <= 60) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, note: sent.trim().slice(0, 140) };
  }

  // 2) tanggal eksplisit: "12 juni 2026" | "juni 12" | "12 des"
  const grab = (m: RegExpMatchArray) => {
    const day = Number(m[1]);
    const bulan = TGE_MONTHS[m[2].toLowerCase()];
    const thn = m[3] ? Number(m[3]) : 0;
    if (!bulan && bulan !== 0) return null;
    if (day < 1 || day > 31) return null;
    const y = thn || now.getFullYear();
    const d = new Date(y, bulan, day);
    if (d.getFullYear() !== y || d.getMonth() !== bulan || d.getDate() !== day) return null; // 31 feb — buang
    if (thn && thn < now.getFullYear()) return null; // tahun lewat = basi
    if (!thn && d.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
      d.setFullYear(d.getFullYear() + 1); // "12 juni" pas udah lewat = maksudnya tahun depan
    }
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, note: sent.trim().slice(0, 140) };
  };
  const m1 = sent.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\b(?:\s+(\d{4}))?/);
  if (m1) {
    const r = grab(m1);
    if (r) return r;
  }
  const m2 = sent.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})\b(?:,?\s+(\d{4}))?/);
  if (m2) {
    const r = grab([m2[0], m2[2], m2[1], m2[3]] as unknown as RegExpMatchArray);
    if (r) return r;
  }
  return null;
}

/** Radar regex buat berita resmi (channel/RSS): tanggal TGE/listing → project + TG alert. */
function noteTgeFromNews(projectId: number, projectName: string, text: string, source: string, link: string): void {
  const hv = heuristicTgeDate(text);
  if (!hv) return;
  db.prepare("UPDATE projects SET tge_date = ? WHERE id = ? AND (tge_date IS NULL OR tge_date = '')").run(hv.date, projectId);
  const ev = storeTgeEvent({ name: projectName, date: hv.date, note: hv.note }, source, link, projectId, projectName);
  if (ev && telegramConfigured()) {
    void sendMessage(
      `🚨 <b>TGE TERKONFIRMASI</b>\n\n<b>${esc(projectName)}</b> — 📅 ${hv.date}\n\n<blockquote>🗓️ ${esc(hv.note)}</blockquote>\n🔗 ${link}\nvia ${esc(source)}`,
    );
  }
}

function storeTgeEvent(
  v: { name: string; date: string | null; note: string },
  source: string,
  link: string,
  projectId?: number,
  projectName?: string,
): number | null {
  if (!projectId) return null; // TGE alerts exist ONLY for farmed projects
  const dup = db.prepare("SELECT 1 FROM tge_events WHERE link = ?").get(link);
  if (dup) return null;
  // same project announcing the same date again = no new alert
  const sameDate = db
    .prepare("SELECT 1 FROM tge_events WHERE project_id = ? AND tge_date = ? AND status = 'new'")
    .get(projectId, v.date);
  if (sameDate) return null;
  const info = db
    .prepare("INSERT INTO tge_events (name, tge_date, note, source, url, link, project_id) VALUES (?,?,?,?,?,?,?)")
    .run(projectName ?? v.name, v.date, v.note, source, link, link, projectId);
  return Number(info.lastInsertRowid);
}

/** Purge stale TGE events: non-portfolio leftovers + anything past TGE+1 day. */
function cleanupTgeEvents(): void {
  db.prepare("DELETE FROM tge_events WHERE project_id IS NULL").run();
  db.prepare("DELETE FROM tge_events WHERE tge_date IS NOT NULL AND tge_date < date('now', 'localtime', '-1 day')").run();
}

/**
 * Retensi 6 bulan: berita & peluang yang lebih tua dari itu dihapus biar
 * tampilan Garapan/Berita/Peluang selalu segar — jalan tiap hari.
 */
export function cleanupOldData(): void {
  const cutNews = db
    .prepare("DELETE FROM news_items WHERE day < date('now', 'localtime', '-180 days')")
    .run().changes;
  const cutOpps = db
    .prepare("DELETE FROM opportunities WHERE created_at < datetime('now', '-180 days')")
    .run().changes;
  // meteran LLM harian & counter backfill lama — gak usah numpuk selamanya
  const cutSettings = db
    .prepare("DELETE FROM settings WHERE key LIKE 'llm_usage_%' AND key < 'llm_usage_' || date('now', 'localtime', '-30 days')")
    .run().changes;
  if (cutNews || cutOpps || cutSettings) {
    console.log(`[retensi] hapus ${cutNews} berita + ${cutOpps} peluang (>6 bulan) + ${cutSettings} settings basi`);
  }
}

/* ---------------- tier buzz di semua grup ---------------- */

/**
 * Tier dari rame-nya obrolan di SEMUA grup arsip: berapa grup yang ngomongin
 * nama ini, berapa pesannya, reaksi, dan terutama reply orang (paling berat).
 * Dipakai buat nge-boost tier peluang — rame di reply orang = sinyal kuat.
 */
export function tgBuzzTier(name: string): "S" | "A" | "B" | "C" | null {
  const tokens = nameTokens(name);
  if (!tokens.length) return null;
  const pats = tokens.map((t) => `%${t.replace(/[%_]/g, " ")}%`);
  // text || ocr_text: poster garapan (foto tanpa caption) ikut dihitung buzz
  const conds = pats.map(() => "lower(text || ' ' || ocr_text) LIKE ?").join(" OR ");
  const rows = db
    .prepare(`SELECT text, ocr_text, chat, COALESCE(reactions, 0) reactions, COALESCE(replies, 0) replies FROM tg_messages WHERE ${conds}`)
    .all(...pats) as Array<{ text: string; ocr_text: string; chat: string; reactions: number; replies: number }>;

  // word-boundary per token biar "dac" gak nyantol di tengah kata lain
  const regexes = tokens.map((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  let msgs = 0;
  let reacts = 0;
  let replies = 0;
  const chats = new Set<string>();
  for (const r of rows) {
    if (!regexes.some((re) => re.test(`${r.text} ${r.ocr_text}`))) continue;
    msgs++;
    chats.add(r.chat);
    reacts += r.reactions;
    replies += r.replies;
  }

  if (!msgs) return null;
  const buzz = msgs * 2 + chats.size * 6 + reacts + replies * 3;
  // S = rame beneran: kedengeran di semua grup arsip + RIBUAN reply orang
  if (chats.size >= 3 && replies >= 4000 && buzz >= 20000) return "S";
  // A = dibahas di beberapa grup dengan ratusan reply, atau thread super-hot di 1 grup
  if ((chats.size >= 3 && replies >= 300) || replies >= 1000) return "A";
  if (msgs >= 2 || buzz >= 10) return "B";
  return "C";
}

const TIER_RANK: Record<string, number> = { S: 3, A: 2, B: 1, C: 0 };

/** Angka followers X dari string klaim — "~300k (akun lama)" -> 300000, "120k" -> 120000, "" -> 0 */
export function parseFollowers(s: string): number {
  const m = String(s ?? "").match(/(\d[\d.,]*)\s*(k|m)\b/i);
  if (!m) {
    const plain = String(s ?? "").match(/(\d[\d.,]{2,})/);
    return plain ? Math.round(parseFloat(plain[1].replace(/,/g, ""))) : 0;
  }
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Math.round(m[2].toLowerCase() === "k" ? n * 1000 : n * 1_000_000);
}

/**
 * Guard NFT: tier S/A gak boleh cuma gara-gara "WL/freemint" — harus beneran rame:
 * hype di X (followers) ATAU banyak komen/reply di pesan grup (buzz).
 * Koleksi gak dikenal + gak dibahas orang = maksimal B.
 */
export function nftTierCap(
  tier: "S" | "A" | "B" | "C",
  name: string,
  xFollowers: string,
): "S" | "A" | "B" | "C" {
  const hype = parseFollowers(xFollowers);
  const buzz = tgBuzzTier(name);
  const rame = hype >= 100_000 || buzz === "S" || buzz === "A";
  const lumayan = hype >= 20_000 || (buzz === "B" || buzz === "A" || buzz === "S");
  if (tier === "S" && !rame) return "A";
  if (tier === "A" && !lumayan) return "B";
  return tier;
}

/**
 * Tier final peluang = yang paling tinggi antara (1) kejelasan data versi
 * LLM dan (2) rame-nya reply orang di semua grup — dua-duanya dihitung.
 */
export function combineTier(base: "S" | "A" | "B" | "C", name: string): "S" | "A" | "B" | "C" {
  const buzz = tgBuzzTier(name);
  if (!buzz) return base;
  return TIER_RANK[buzz] > TIER_RANK[base] ? buzz : base;
}
/* ---------------- classification ---------------- */

/** Strong "mainnet is live/launched/migrated" signal — not just any mainnet mention. */
const MAINNET_LIVE =
  /mainnet[^.\n]{0,60}(live|launch|migrat|aktif)|(live|launch|migrat)[^.\n]{0,50}mainnet|(sudah|udah|telah)\s*mainnet/i;

/**
 * Testnet → mainnet auto-promotion: when a message about a farmed testnet
 * project clearly says its mainnet is live/launched/migrated, the project
 * moves to the Mainnet group on the dashboard (+ TG ping).
 * Returns true when the promotion happened.
 */
function promoteToMainnetIfLive(
  projectId: number,
  categoryName: string,
  text: string,
  projectName: string,
  source: string,
  link: string,
): boolean {
  if (categoryName !== "mainnet") return false;
  if (!MAINNET_LIVE.test(text)) return false;
  const cur = db.prepare("SELECT category FROM projects WHERE id = ?").get(projectId) as
    | { category: string }
    | undefined;
  if (!cur || cur.category !== "testnet") return false;
  db.prepare("UPDATE projects SET category = 'mainnet' WHERE id = ?").run(projectId);
  console.log(`[mainnet] ${projectName} promoted to mainnet (via ${source})`);
  if (telegramConfigured()) {
    void sendMessage(
      `🚀 <b>${projectName} udah MAINNET</b>\nProject pindah otomatis ke grup Mainnet di dashboard.\nvia ${source}\n${link}`,
    );
  }
  return true;
}

function classify(text: string): { category: string; important: boolean } {
  let category = "other";
  for (const [cat, re] of KEYWORDS) {
    if (re.test(text)) {
      category = cat;
      break;
    }
  }
  const important = ["tge", "snapshot", "claim", "listing", "tokenomics", "funding"].includes(category);
  return { category, important };
}

async function llmClassify(
  item: NewsItemInput,
  projectNames: string[],
): Promise<{ category: string; important: boolean; project: string | null; tge_date?: string | null; summary?: string } | null> {
  if (!llmConfigured()) return null;
  try {
    const text = await llmChat({
      messages: [
        {
          role: "system",
          content:
            `You classify crypto airdrop news for an airdrop farmer. Portfolio projects: ${projectNames.join(", ")}. ` +
            `Return STRICT JSON: {category: "tge|snapshot|mainnet|listing|claim|deadline|other", important: boolean (true if farmer must act today), project: matched portfolio project name or null, tge_date: "YYYY-MM-DD" if the text announces a specific token generation event / listing date, else null, summary: string (ringkasan isi beritanya dalam Bahasa Indonesia, maksimal 20 kata, jangan pake link/URL, langsung ke poin)}`,
        },
        { role: "user", content: `${item.title}\n\n${item.body}`.slice(0, 1500) },
      ],
      max_tokens: 2000,
      json: true,
      timeoutMs: 70000,
    });
    if (!text) return null;
    const raw = parseChatJson(text)?.content;
    if (!raw) return null;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ---------------- main poll ---------------- */

interface ProjectRow {
  id: number;
  name: string;
  url: string;
  rss_url: string;
  enrichment: string | null;
}

/** Guess a telegram channel name from enrichment.telegram, enrichment.x handle, or project name. */
function guessChannel(p: ProjectRow): string | null {
  const enr: Enrichment | null = p.enrichment ? JSON.parse(p.enrichment) : null;
  if (enr?.telegram) {
    const handle = enr.telegram.replace(/https?:\/\/t\.me\/(s\/)?/, "").replace(/^@/, "").split("/")[0];
    if (handle) return handle.toLowerCase();
  }
  const handle = enr?.x?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/)?.[1];
  return handle ? handle.toLowerCase() : p.name.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

declare global {
  // eslint-disable-next-line no-var
  var __poll_busy: boolean | undefined;
}

export async function pollNews(): Promise<number> {
  // LLM calls can take minutes — never let two polls overlap (double LLM spend)
  if (globalThis.__poll_busy) {
    console.log("[poll] skipped — previous run still in progress");
    return 0;
  }
  globalThis.__poll_busy = true;
  try {
    const inserted = await pollNewsInner();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_poll', ?)").run(
      new Date().toISOString(),
    );
    return inserted;
  } finally {
    globalThis.__poll_busy = false;
  }
}

async function pollNewsInner(): Promise<number> {
  const projects = db.prepare("SELECT id, name, url, rss_url, enrichment FROM projects WHERE status = 'active'").all() as ProjectRow[];
  const projectNames = projects.map((p) => p.name);
  cleanupTgeEvents();

  // per-project channels: telegram channel name stored in settings key tg_channel:<project_id>
  const tgRows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'tg_channel:%'").all() as Array<{ key: string; value: string }>;
  const tgMap = new Map<number, string>();
  for (const r of tgRows) tgMap.set(Number(r.key.split(":")[1]), r.value);

  let inserted = 0;
  const seen = new Set<string>();

  // ---- source A: userbot — archive every joined chat, then process fresh messages ----
  if (userbotConfigured()) {
    const { messages, sessionLost } = await archiveJoinedChats(20).catch(() => ({
      messages: [] as TgMessage[],
      sessionLost: false,
    }));
    if (sessionLost) {
      // alert once — finder monitoring is dead until the user re-logs in
      const alerted = db.prepare("SELECT value FROM settings WHERE key = 'tg_session_alerted'").get();
      if (!alerted) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tg_session_alerted', '1')").run();
        void sendMessage(
          "⚠️ <b>Session Telegram userbot gak valid lagi</b>\nMonitoring grup finder mati.\nLogin ulang di web ASAP biar berita &amp; peluang jalan lagi.",
        );
        console.error("[poll] tg userbot session lost — re-login needed");
      }
    } else {
      db.prepare("DELETE FROM settings WHERE key = 'tg_session_alerted'").run();
    }
    const hints = projects.map((p) => buildHints(p, tgMap.get(p.id) ?? null));
    // each message is LLM-evaluated at most ONCE. Without this flag the last-20
    // per-chat window gets re-evaluated every 5 min forever — the poll never
    // finishes and the LLM keeps paying for the same old messages.
    const markProcessed = db.prepare("UPDATE tg_messages SET processed = 1 WHERE link = ?");
    for (const m of messages) {
      if (seen.has(m.link)) continue;
      seen.add(m.link);
      const row = db.prepare("SELECT processed FROM tg_messages WHERE link = ?").get(m.link) as
        | { processed: number }
        | undefined;
      if (row?.processed) continue;
      // pesan foto-tanpa-teks: OCR dulu biar ikut ke-match & ke-evaluasi
      if (m.photoPending) {
        const ocr = await ocrPhoto(m.chat, m.id, m.link);
        if (ocr) m.text = `${m.text}\n${ocr}`.trim();
        else if (!m.text) {
          markProcessed.run(m.link); // gak ada teks sama sekali — skip, jangan boncos
          continue;
        }
      }
      await processCommunityMessage(m, projects, hints, projectNames, (n) => (inserted += n));
      markProcessed.run(m.link);
    }
  }

  // ---- source B: public channel web preview per project ----
  for (const p of projects) {
    const channel = tgMap.get(p.id) ?? guessChannel(p);
    if (channel) {
      const items = await fetchTelegramChannel(channel);
      for (const item of items) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        const text = `${item.title} ${item.body}`;
        let { category, important } = classify(text);
        promoteToMainnetIfLive(p.id, category, text, p.name, item.source, item.link);
        // radar TGE regex — pengumuman resmi channel project, gak butuh LLM
        if (/\b(tge|listing|snapshot|launch(?:ing| date)?)\b/i.test(text)) {
          noteTgeFromNews(p.id, p.name, text, item.source, item.link);
        }

        // official project channel — vet important hits to refine + extract TGE date
        let summary = "";
        if (llmConfigured() && important) {
          const r = await llmClassify(item, projectNames).catch(() => null);
          if (r) {
            if (r.category) category = r.category;
            important = important || Boolean(r.important);
            summary = String(r.summary ?? "").slice(0, 200);
            if (r.tge_date && /^\d{4}-\d{2}-\d{2}$/.test(r.tge_date)) {
              db.prepare("UPDATE projects SET tge_date = ? WHERE id = ? AND (tge_date IS NULL OR tge_date = '')").run(r.tge_date, p.id);
            }
          }
        }
        const stored = storeItem(item, p.id, category, important);
        if (stored) inserted++;
        if (stored && important && telegramConfigured()) {
          const cm = catMeta(category);
          await sendMessage(
            `📣 <b>Update Garapan</b>\n` +
              `<b>${esc(p.name)}</b> ${cm.icon} ${cm.label}\n` +
              `via channel resmi\n\n` +
              `<blockquote>💬 ${esc(summary || item.title)}</blockquote>\n` +
              `${item.link}`,
          );
        }
      }
    }
  }

  // ---- source C: RSS feeds ----
  const feedUrls = (process.env.NEWS_FEEDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of projects) if (p.rss_url) feedUrls.push(p.rss_url);

  for (const url of feedUrls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const items = await fetchFeed(url);
    for (const item of items) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      const text = `${item.title} ${item.body}`;
      let { category, important } = classify(text);
      let matched: ProjectRow | null =
        projects.find((p) => p.name.length > 2 && text.toLowerCase().includes(p.name.toLowerCase())) ?? null;
      if (matched) promoteToMainnetIfLive(matched.id, category, text, matched.name, item.source, item.link);
      // radar TGE regex buat RSS/blog resmi project yang ke-match
      if (matched && /\b(tge|listing|snapshot|launch(?:ing| date)?)\b/i.test(text)) {
        noteTgeFromNews(matched.id, matched.name, text, item.source, item.link);
      }

      let rssSummary = "";
      if (llmConfigured() && (matched || important)) {
        const r = await llmClassify(item, projectNames);
        if (r) {
          if (r.category) category = r.category;
          important = important || Boolean(r.important);
          rssSummary = String(r.summary ?? "").slice(0, 200);
          const rp = r.project;
          // same as community messages: only accept the LLM's project claim when
          // the item text actually mentions that project
          if (rp) {
            const cand = projects.find((p) => p.name.toLowerCase() === rp.toLowerCase());
            if (cand && mentionsProject(text, buildHints(cand))) matched = cand;
          }
          if (matched && r.tge_date && /^\d{4}-\d{2}-\d{2}$/.test(r.tge_date)) {
            db.prepare("UPDATE projects SET tge_date = ? WHERE id = ? AND (tge_date IS NULL OR tge_date = '')").run(r.tge_date, matched.id);
          }
        }
      }
      // keep the news tab strictly about portfolio projects
      if (!matched) continue;
      const stored = storeItem(item, matched.id, category, important);
      if (stored) inserted++;
      if (stored && important && telegramConfigured()) {
        const cm = catMeta(category);
        await sendMessage(
          `📣 <b>Update Garapan</b>\n` +
            `<b>${esc(matched.name)}</b> ${cm.icon} ${cm.label}\n` +
            `via ${esc(item.source)}\n\n` +
            `<blockquote>💬 ${esc(rssSummary || item.title)}</blockquote>\n` +
            `${item.link}`,
        );
      }
    }
  }

  // ---- self-heal: retry research for recently added projects whose enrich failed ----
  if (llmConfigured()) {
    const unriched = db
      .prepare(
        `SELECT id, url, name FROM projects
         WHERE status = 'active' AND enrichment IS NULL AND url != ''
           AND created_at > datetime('now', '-24 hours')
           AND created_at < datetime('now', '-10 minutes')`,
      )
      .all() as Array<{ id: number; url: string; name: string }>;
    for (const p of unriched.slice(0, 1)) {
      const tries = Number(
        (db.prepare("SELECT value FROM settings WHERE key = ?").get(`enrich_try:${p.id}`) as { value: string } | undefined)
          ?.value ?? 0,
      );
      if (tries >= 3) continue;
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        `enrich_try:${p.id}`,
        String(tries + 1),
      );
      console.log(`[poll] retrying enrichment for ${p.name} (try ${tries + 1}/3)`);
      const e = await enrichProject(p.url, p.name).catch(() => null);
      if (e) {
        db.prepare("UPDATE projects SET enrichment = ?, name = ? WHERE id = ?").run(
          JSON.stringify(e),
          e.name || p.name,
          p.id,
        );
        void deepBackfillProject(p.id).catch(() => 0);
      }
    }
  }

  return inserted;
}

/* ---------------- notif TG rapi + kekuatan match ---------------- */

const CAT_META: Record<string, { icon: string; label: string }> = {
  tge: { icon: "🚨", label: "TGE" },
  snapshot: { icon: "📸", label: "Snapshot" },
  mainnet: { icon: "🟢", label: "Mainnet live" },
  listing: { icon: "📈", label: "Listing" },
  claim: { icon: "🎁", label: "Claim" },
  deadline: { icon: "⏰", label: "Deadline" },
  funding: { icon: "💰", label: "Funding" },
  tokenomics: { icon: "🪙", label: "Tokenomics" },
  other: { icon: "📢", label: "Info" },
};

function catMeta(cat: string): { icon: string; label: string } {
  return CAT_META[cat] ?? CAT_META.other;
}

const TYPE_LABEL: Record<string, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
  nft: "WL/Mint NFT",
  quest: "Quest",
  node: "Node",
  waitlist: "Waitlist",
  social: "Social",
  bot: "Bot",
  other: "Lainnya",
};
const EFFORT_LABEL: Record<string, string> = { low: "ringan", medium: "sedang", high: "berat" };
const TYPE_ICON: Record<string, string> = {
  testnet: "🧪",
  mainnet: "🌐",
  nft: "🖼️",
  quest: "📋",
  node: "🖥️",
  waitlist: "📝",
  social: "📣",
  bot: "🤖",
  other: "✨",
};

/** escape teks buat HTML Telegram biar parse gak gagal. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Kekuatan mention: "strong" = nama lengkap / ticker eksplisit / @handle / domain,
 * "weak" = cuma kata generik dari nama (mis. "model" dari "Action Model").
 * Weak match gak langsung dipercaya — tunggu konfirmasi LLM.
 */
function matchStrength(text: string, h: MatchHints): "strong" | "weak" | null {
  const t = text.toLowerCase();
  if (h.name.length > 2 && new RegExp(`\\b${h.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) return "strong";
  // token dari isi kurung / ticker ALL-CAPS = identitas kuat
  const strongToks = new Set<string>();
  for (const paren of h.name.matchAll(/\(([^()]+)\)/g)) {
    for (const w of paren[1].match(/[A-Za-z0-9]+/g) ?? []) strongToks.add(w.toLowerCase());
  }
  for (const w of h.name.match(/\b[A-Z0-9]{2,6}\b/g) ?? []) strongToks.add(w.toLowerCase());
  for (const tok of h.tokens) {
    if (GENERIC_WORDS.has(tok)) continue; // kata generik gak bisa jadi penanda lemah
    if (!new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) continue;
    return strongToks.has(tok) ? "strong" : "weak";
  }
  if (h.handle && t.includes(`@${h.handle}`)) return "strong";
  if (h.channel && t.includes(`@${h.channel}`)) return "strong";
  if (h.domain && t.includes(h.domain)) return "strong";
  if (h.pathKey && t.includes(h.pathKey)) return "strong"; // link quest sama = project sama
  return null;
}

/** Handle a message from a joined community chat (group/channel via userbot). */
/**
 * OCR foto pesan via vision LLM — hasilnya dipakai pipeline berita biar poster
 * garapan (sering cuma gambar tanpa caption) tetep kebaca & ke-match ke project.
 * Sekali OCR per pesan (hasil disimpen di tg_messages.ocr_text), gagal = "".
 */
async function ocrPhoto(chat: string, messageId: number, link: string): Promise<string> {
  const row = db.prepare("SELECT ocr_text FROM tg_messages WHERE link = ?").get(link) as
    | { ocr_text: string }
    | undefined;
  if (row && row.ocr_text) return row.ocr_text;
  if (!llmConfigured()) return "";

  const b64 = await downloadPhoto(chat, messageId).catch(() => null);
  if (!b64) return "";

  try {
    const raw = await llmChat({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "This is a screenshot/photo from a crypto airdrop finder Telegram group. " +
                "Transcribe ALL readable text (project name, tasks, links, dates, rewards). " +
                "Keep it compact, plain text, no commentary. If there is no readable text, reply with just: EMPTY",
            },
            { type: "image_url", image_url: { url: b64 } },
          ],
        },
      ],
      max_tokens: 2000,
      vision: true,
      timeoutMs: 80000,
    });
    let content = (parseChatJson(raw ?? "")?.content ?? "").trim();
    // model kadang bungkus hasilnya {"text": "..."} walau diminta plain text — buka bungkusnya
    try {
      const j = JSON.parse(content) as { text?: string };
      if (j && typeof j.text === "string") content = j.text.trim();
    } catch {
      /* plain text — biarkan */
    }
    if (!content || /^empty$/i.test(content)) return "";
    // simpan sekali — pesan gak di-OCR ulang tiap poll
    db.prepare("UPDATE tg_messages SET ocr_text = ? WHERE link = ?").run(content.slice(0, 700), link);
    console.log(`[ocr] ${chat}/${messageId}: ${content.slice(0, 60)}…`);
    return content.slice(0, 700);
  } catch {
    return "";
  }
}

async function processCommunityMessage(
  m: TgMessage,
  projects: ProjectRow[],
  hints: MatchHints[],
  projectNames: string[],
  onInserted: (n: number) => void,
) {  const item: NewsItemInput = {
    title: cleanTitle(m.text).slice(0, 120),
    link: m.link,
    body: m.text.slice(0, 700),
    source: `tg:${m.chatTitle}`,
    date: m.date.toISOString(),
  };
  // ringkasan harian grup (daily recap) = daftar isi kemarin, bukan berita — jangan masuk feed
  if (RECAP_GATE.test(m.text.slice(0, 120))) return;
  if (db.prepare("SELECT 1 FROM news_items WHERE url = ?").get(item.link)) return;
  if (db.prepare("SELECT 1 FROM opportunities WHERE link = ?").get(item.link)) return;

  const text = `${m.chatTitle} ${m.text}`;
  let { category, important } = classify(text);
  let matched: ProjectRow | null = null;
  let matchedIdx = -1;
  let strongMatch = false;
  for (let i = 0; i < projects.length; i++) {
    const s = matchStrength(text, hints[i]);
    if (s) {
      matched = projects[i];
      matchedIdx = i;
      strongMatch = s === "strong";
      break;
    }
  }
  let summary = "";

  // community chatter is noisy — always LLM-vet messages that keyword-match a portfolio project
  if (llmConfigured() && (matched || important)) {
    const r = await llmClassify(
      { ...item, title: `[${m.chatTitle}] ${item.title}` },
      projectNames,
    ).catch(() => null);
    if (r) {
      if (r.category) category = r.category;
      important = important || Boolean(r.important);
      summary = String(r.summary ?? "").slice(0, 200);
      const rp = r.project;
      // the LLM sometimes "recognizes" a portfolio project in unrelated chatter
      // (e.g. "semoga aja nanti no vesting" → matched to a random farmed project).
      // Only trust its claim when the message actually mentions that project
      // (name / @handle / @channel / domain).
      if (rp && !matched) {
        const idx = projects.findIndex((p) => p.name.toLowerCase() === rp.toLowerCase());
        if (idx >= 0 && mentionsProject(text, hints[idx])) {
          matched = projects[idx];
          matchedIdx = idx;
          strongMatch = true; // LLM + mention nyata = percaya
        }
      }
      // match cuma dari kata generik (mis. "model") & LLM gak bilang ini project itu → batal atribusi
      if (matched && !strongMatch && rp?.toLowerCase() !== matched.name.toLowerCase()) {
        matched = null;
      }
      if (matched && r.tge_date && /^\d{4}-\d{2}-\d{2}$/.test(r.tge_date)) {
        db.prepare("UPDATE projects SET tge_date = ? WHERE id = ? AND (tge_date IS NULL OR tge_date = '')").run(r.tge_date, matched.id);
      }
    }
  }

  if (matched) {
    // testnet → mainnet auto-promotion from finder/official intel
    promoteToMainnetIfLive(matched.id, category, text, matched.name, `tg:${m.chatTitle}`, m.link);
    // news about a portfolio project → per-project feed + instant push
    const stored = storeItem(item, matched.id, category, important);
    if (stored) onInserted(1);
    if (stored && important && telegramConfigured()) {
      const cm = catMeta(category);
      await sendMessage(
        `📣 <b>Update Garapan</b>\n` +
          `<b>${esc(matched.name)}</b> ${cm.icon} ${cm.label}\n` +
          `via ${esc(m.chatTitle)}\n\n` +
          `<blockquote>💬 ${esc(summary || item.title)}</blockquote>\n` +
          `${item.link}`,
      );
    }
    // late finder intel: extract actionable missions (badge/quest/check-in…) for this project
    if (TASK_GATE.test(m.text)) {
      const seeds = await llmExtractMissions(matched.name, m.text).catch(() => null);
      if (seeds && seeds.length) {
        // sumber misi = pesan grup yang ngasih quest-nya
        for (const s of seeds) s.source = m.link;
        const added = insertMissions(matched.id, seeds);
        if (added.length > 0 && telegramConfigured()) {
          await sendMessage(
            `🆕 <b>MISI BARU</b>\n\n` +
              `<b>${esc(matched.name)}</b>\n\n` +
              `<blockquote>${added.map((t) => `• ${esc(t)}`).join("\n")}</blockquote>\n` +
              `🔗 ${m.link}\n` +
              `via ${esc(m.chatTitle)}`,
          );
        }
      }
    }
    // TGE radar: ONLY for projects the farmer actually farms — a confirmed
    // TGE/listing date from a finder becomes a tracked event + TG alert
    if (/\b(tge|token generation|listing|snapshot|launch(?:ing| date)?)\b/i.test(m.text)) {
      const hv = heuristicTgeDate(text);
      const v = (await llmExtractTge(text)) ?? (hv ? { name: matched.name, date: hv.date, note: hv.note } : null);
      if (v?.date) {
        db.prepare("UPDATE projects SET tge_date = ? WHERE id = ? AND (tge_date IS NULL OR tge_date = '')").run(
          v.date,
          matched.id,
        );
        const evId = storeTgeEvent({ ...v, date: v.date }, `tg:${m.chatTitle}`, m.link, matched.id, matched.name);
        if (evId && telegramConfigured()) {
          onInserted(1);
          await sendMessage(
            `🚨 <b>TGE TERKONFIRMASI</b>\n\n` +
              `<b>${esc(matched.name)}</b> — 📅 ${v.date}\n\n` +
              `<blockquote>🗓️ ${esc(v.note)}</blockquote>\n` +
              `🔗 ${m.link}\n` +
              `via ${esc(m.chatTitle)}`,
          );
        }
      }
    }
    return;
  }

  // not about a portfolio project → opportunity pipeline (finder groups).
  // gate on keywords to keep LLM cost sane, skip known-noise patterns.
  // LLM gagal/mati/limit → verdict heuristik (nama dari link, tier B) —
  // tab Peluang tetep ke-update tanpa nunggu LLM
  if (!OPPO_GATE.test(m.text)) return;
  if (/sponsor(ed)?|promoted|advertis/i.test(m.text.slice(0, 100))) return;
  const verdict = (await llmEvaluateOpportunity(m)) ?? heuristicVerdict(m);
  if (!verdict || !verdict.name) return;
  // tier final: kejelasan data + rame reply di semua grup
  verdict.tier = combineTier(verdict.tier, verdict.name);
  const oppId = storeOpportunity(m, verdict);
  if (oppId) {
    onInserted(1);
    if (telegramConfigured() && (verdict.tier === "S" || verdict.tier === "A")) {
      const sigRows = [
        verdict.funding ? `• 💰 Funding: ${esc(verdict.funding)}` : "",
        verdict.tokenomics ? `• 🪙 Tokenomics: ${esc(verdict.tokenomics)}` : "",
        verdict.x_followers ? `• 🐦 X: ${esc(verdict.x_followers)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const head =
        verdict.tier === "S"
          ? `💎 <b>PELUANG BARU — TIER S</b>`
          : `🥇 <b>PELUANG BARU — TIER A</b>`;
      // link kerjain (bot/quest dari pesan) kalau beda dari link pesan grup
      const kerjaLink = verdict.link && verdict.link !== m.link ? verdict.link : "";
      await sendAndGetIdButtons(
        `${head}\n\n` +
          `<b>${esc(verdict.name)}</b>\n` +
          `${TYPE_ICON[verdict.quest_type] ?? "✨"} ${TYPE_LABEL[verdict.quest_type] ?? "Lainnya"} · ⚡ Effort ${EFFORT_LABEL[verdict.effort] ?? verdict.effort}\n\n` +
          `<blockquote>💡 ${esc(verdict.reasons)}</blockquote>\n` +
          (sigRows ? `📊 <b>Sinyal:</b>\n${sigRows}\n` : "") +
          (kerjaLink ? `🎮 Kerjain: ${kerjaLink}\n` : "") +
          `💬 Pesan asli: ${m.link}\n` +
          `via ${esc(m.chatTitle)}`,
        [
          [
            { text: "⚡ Garap", callback_data: `opp:garap:${oppId}` },
            { text: "✖ Lewati", callback_data: `opp:lewat:${oppId}` },
          ],
        ],
      );
    }
  }
}

/* ---------------- auto-missions (Galxe-style quest list) ---------------- */

interface MissionSeed {
  title: string;
  freq: "daily" | "weekly" | "once";
  onchain: boolean;
  chain: string;
  link: string;
  source: string;
}

const MISSION_TEMPLATES: MissionSeed[] = [
  { title: "Daily check-in / login", freq: "daily", onchain: false, chain: "", link: "", source: "" },
  { title: "Selesaikan quest harian di app", freq: "daily", onchain: false, chain: "", link: "", source: "" },
];

/**
 * Ask the LLM for project-specific missions (badge, mint NFT, swap, testnet tx…)
 * grounded in the enrichment + finder chatter about this project.
 */
async function llmGenerateMissions(
  name: string,
  enrichment: Enrichment | null,
  chatter: string,
): Promise<MissionSeed[] | null> {
  if (!llmConfigured()) return null;
  try {
    const text = await llmChat({
      messages: [
        {
          role: "system",
          content:
            `You design a farming mission checklist for a crypto airdrop project (Galxe-style). ` +
            `Use the project info and finder-group chatter. Missions must be concrete, actionable tasks the farmer does in the app/site (e.g. "Mint badge Wave 3", "Swap minimal $10 di testnet", "Deploy smart contract di testnet", "Bikin LP + stake"). ` +
            `If the chatter describes a WEEKLY campaign series (Week 1, Week 2, Season S4, etc.), create ONE task per week with the week number in the title (e.g. "Week 1: isi form quest di Galxe", "Week 2: socials task"), freq "once". ` +
            `Form-filling tasks (Google Form, registration form, whitelist form) count as missions too — include them explicitly. ` +
            `Daily recurring stuff (check-in, daily quest) is added automatically — do not duplicate those. ` +
            `Each chatter line ends with "src:" + the t.me permalink of that message. ` +
            `For each mission: "link" = the EXACT URL where the task is done (quest/form/app page) copied from info/chatter — NEVER a t.me/telegram message link, never invent one, use "" if absent. ` +
            `"source" = the t.me permalink from the src: of the chatter line this mission comes from, "" if unclear. ` +
            `Return STRICT JSON: {missions: [{title: string (Indonesian, max 60 chars, specific), freq: "once"|"daily"|"weekly", onchain: boolean, chain: string ("" | e.g. "base-sepolia"), link: string (exact task URL or ""), source: string (t.me permalink from chatter or "")}]} — max 8 missions. If nothing concrete is known, return an empty list.`,
        },
        {
          role: "user",
          content:
            `Project: ${name}\n` +
            `Info: ${JSON.stringify(enrichment ?? {}).slice(0, 800)}\n` +
            `Finder chatter:\n${chatter.slice(0, 2200)}`,
        },
      ],
      max_tokens: 2000,
      json: true,
      timeoutMs: 90000,
    });
    if (!text) return null;
    const raw = parseChatJson(text)?.content;
    if (!raw) return null;
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s === -1 || e <= s) return null;
    const v = JSON.parse(raw.slice(s, e + 1)) as { missions?: MissionSeed[] };
    if (!Array.isArray(v.missions)) return null;
    return v.missions
      .filter((m) => m && typeof m.title === "string" && m.title.trim())
      .slice(0, 8)
      .map((m) => {
        // link = halaman tugasnya (bukan t.me); source = permalink t.me pesan sumbernya.
        // dua-duanya harus beneran ke-sebut di chatter/info — buatan gak dipakai
        const chatAll = chatter + JSON.stringify(enrichment ?? {});
        const link = typeof m.link === "string" ? m.link.trim() : "";
        const source = typeof m.source === "string" ? m.source.trim() : "";
        return {
          title: m.title.trim().slice(0, 80),
          freq: (["daily", "weekly", "once"].includes(m.freq) ? m.freq : "once") as MissionSeed["freq"],
          onchain: Boolean(m.onchain),
          chain: typeof m.chain === "string" ? m.chain.slice(0, 20) : "",
          link:
            link && /^https?:\/\//.test(link) && !/t\.me|telegram\.(me|org)/.test(link) && chatAll.includes(link)
              ? link
              : "",
          source:
            source && /^https?:\/\/t\.me\//.test(source) && chatAll.includes(source) ? source : "",
        };
      });
  } catch {
    return null;
  }
}

/** Late-intel mission gate: message clearly describes doable tasks for a portfolio project. */
const TASK_GATE =
  /badge|mint|quest|task|check.?in|points?|faucet|swap|stake|deposit|campaign|daily|whitelist|\bwl\b|nft|referr/i;

/** Extract concrete missions from ONE community message about a farmed project. */
async function llmExtractMissions(
  projectName: string,
  text: string,
): Promise<MissionSeed[] | null> {
  if (!llmConfigured()) return null;
  try {
    const text2 = await llmChat({
      messages: [
        {
          role: "system",
          content:
            `You extract farming missions from a Telegram message about a crypto project the farmer already farms (${projectName}). ` +
            `Missions = concrete doable actions (mint badge, claim quest, daily check-in, swap X amount, faucet, connect wallet, KYC...). ` +
            `Announcements/news/price talk are NOT missions. Merge steps of one flow into a single mission. ` +
            `For each mission, copy the EXACT URL where the task is done from this message into "link" — the quest/form/app page, NEVER a t.me/telegram message link; use "" if the message has none. ` +
            `Return STRICT JSON: {missions: [{title: string (Indonesian, max 60 chars, specific), freq: "once"|"daily"|"weekly", onchain: boolean, chain: string ("" or e.g. "base-sepolia"), link: string (exact task URL from this message or "")}]}. ` +
            `Return an empty missions array if nothing actionable.`,
        },
        { role: "user", content: text.slice(0, 1500) },
      ],
      max_tokens: 2000,
      json: true,
      timeoutMs: 80000,
    });
    if (!text2) return null;
    const raw = parseChatJson(text2)?.content;
    if (!raw) return null;
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s === -1 || e <= s) return null;
    const v = JSON.parse(raw.slice(s, e + 1)) as { missions?: MissionSeed[] };
    if (!Array.isArray(v.missions)) return null;
    return v.missions
      .filter((m) => m && typeof m.title === "string" && m.title.trim())
      .slice(0, 6)
      .map((m) => {
        // link harus URL tugas yang beneran ada di pesan ini — t.me bukan link tugas, diabaikan
        const link = typeof m.link === "string" ? m.link.trim() : "";
        return {
          title: m.title.trim().slice(0, 80),
          freq: (["daily", "weekly", "once"].includes(m.freq) ? m.freq : "once") as MissionSeed["freq"],
          onchain: Boolean(m.onchain),
          chain: typeof m.chain === "string" ? m.chain.slice(0, 20) : "",
          link: link && /^https?:\/\//.test(link) && !/t\.me|telegram\.(me|org)/.test(link) && text.includes(link) ? link : "",
          // sumber diisi di call site: link t.me pesan aslinya
          source: "",
        };
      });
  } catch {
    return null;
  }
}

/* fuzzy task dedupe: different groups describe the same mission differently —
   "Daily badge" vs "Claim badge harian" must count as ONE task */
const STOP_WORDS = new Set([
  "dan", "yang", "di", "ke", "dari", "untuk", "dengan", "atau", "the", "and", "for", "with",
  "app", "web", "site", "ini", "itu", "your", "baru", "lagi",
]);

function titleTokens(t: string): string[] {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function similarTitle(a: string, b: string): boolean {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.length || !B.length) return false;
  const setA = new Set(A);
  let shared = 0;
  for (const w of B) if (setA.has(w)) shared++;
  return shared / Math.min(A.length, B.length) >= 0.5;
}

/**
 * Insert missions for a project with cross-source dedupe:
 * skips near-duplicates of existing tasks (and of each other in the same batch).
 * Returns the titles actually added.
 */
function insertMissions(projectId: number, missions: MissionSeed[]): string[] {
  const added: string[] = [];
  const existing = (
    db.prepare("SELECT title FROM tasks WHERE project_id = ?").all(projectId) as Array<{ title: string }>
  ).map((r) => r.title);
  const stmt = db.prepare("INSERT INTO tasks (project_id, title, freq, onchain, chain, link, source) VALUES (?,?,?,?,?,?,?)");
  for (const m of missions) {
    const title = m.title.trim();
    if (!title) continue;
    const dup = existing.some((t) => t.toLowerCase() === title.toLowerCase() || similarTitle(t, title));
    if (dup) continue;
    // link = halaman tugasnya; t.me di link lama (sebelum aturan ini) ditesimpan ulang sebagai sumber
    let link = typeof m.link === "string" && /^https?:\/\//.test(m.link.trim()) ? m.link.trim() : "";
    let source = typeof m.source === "string" && /^https?:\/\/t\.me\//.test(m.source.trim()) ? m.source.trim() : "";
    if (/t\.me|telegram\.(me|org)/.test(link)) {
      if (!source) source = link;
      link = "";
    }
    stmt.run(projectId, title, m.freq, m.onchain ? 1 : 0, m.chain, link, source);
    existing.push(title);
    added.push(title);
  }
  return added;
}

/**
 * Deep backfill for a newly added project:
 * 1. pull long history from all joined finder chats (up to ~1 year),
 * 2. attach every mentioning message as project news (oldest→newest),
 * 3. generate Galxe-style missions grounded in that chatter.
 */
/**
 * Reconcile: project aktif yang masih "Daily task" doang & gak punya channel
 * diproses lagi — news udah masuk tapi misi blum kebikin pun tetap ke-retry.
 * - Dipanggil pas server start (gap 0) DAN tiap 15 menit dari scheduler (gap 15m).
 * - Stamp `backfill_last:<id>` + counter `backfill_tries:<id>` biar project yang emang
 *   gak pernah dibahas grup gak jalan deep-scan berat terus-menerus (max 8x coba).
 */
export function backfillPendingProjects(minGapMs = 0): void {  const rows = db
    .prepare(
      `SELECT p.id FROM projects p
       WHERE p.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.title != 'Daily task')
         AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = 'tg_channel:' || p.id)`,
    )
    .all() as Array<{ id: number }>;

  const now = Date.now();
  for (const r of rows) {
    const last = db.prepare("SELECT value FROM settings WHERE key = ?").get(`backfill_last:${r.id}`) as
      | { value: string }
      | undefined;
    if (last && now - Number(last) < minGapMs) continue;
    const tries = db.prepare("SELECT value FROM settings WHERE key = ?").get(`backfill_tries:${r.id}`) as
      | { value: string }
      | undefined;
    if ((Number(tries?.value ?? 0)) >= 8) continue;

    const p = db.prepare("SELECT id, name, url FROM projects WHERE id = ?").get(r.id) as { id: number; name: string; url: string } | undefined;
    if (!p) continue;
    // stamp + counter dululu, biar tick berikutnya gak nembak dua kali
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`backfill_last:${p.id}`, String(now));
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      `backfill_tries:${p.id}`,
      String(Number(tries?.value ?? 0) + 1),
    );
    console.log(`[backfill-reconcile] project ${p.id} (${p.name}) belum ke-backfill, jalanin ulang`);
    void deepBackfillProject(p.id)
      .then((res) => console.log(`[backfill-reconcile] project ${p.id}: +${res.news} news, +${res.missions} missions`))
      .catch((e: unknown) => console.error(`[backfill-reconcile] project ${p.id} gagal:`, e));
  }
}

/**
 * Ngisiin link tugas + sumber t.me buat misi LAMA yang dibikin sebelum fitur link
 * (kolom link & source masih kosong). Judul task + chatter (tiap baris ujungnya
 * "src: <t.me>") dikirim ke LLM buat dipasangin, divalidasi sama ketat kayak
 * llmGenerateMissions: link harus URL tugas (bukan t.me), source harus permalink
 * t.me, dua-duanya harus beneran ada di teks chatter — buatan gak lolos.
 * Balikin jumlah task yang keisi.
 */
export async function relinkMissions(projectId: number): Promise<number> {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
  if (!p || !llmConfigured()) return 0;

  const empty = db
    .prepare("SELECT id, title FROM tasks WHERE project_id = ? AND freq = 'once' AND link = '' AND source = ''")
    .all(projectId) as Array<{ id: number; title: string }>;
  if (empty.length === 0) return 0;

  const channelRow = db.prepare("SELECT value FROM settings WHERE key = ?").get(`tg_channel:${p.id}`) as
    | { value: string }
    | undefined;
  const hint = buildHints(p, channelRow?.value ?? null);

  const rows = db
    .prepare("SELECT chat_title, text, ocr_text, link FROM tg_messages WHERE date IS NOT NULL ORDER BY date ASC")
    .all() as Array<{ chat_title: string; text: string; ocr_text: string; link: string }>;
  const chatter: string[] = [];
  for (const r of rows) {
    if (!mentionsProject(`${r.chat_title} ${r.text} ${r.ocr_text}`, hint)) continue;
    chatter.push(`- ${`${r.text} ${r.ocr_text}`.slice(0, 200)}\n  src: ${r.link}`);
  }
  if (chatter.length === 0) return 0;
  const chatAll = chatter.join("\n").slice(0, 6000);

  try {
    const text = await llmChat({
      messages: [
        {
          role: "system",
          content:
            `You attach evidence links to existing airdrop mission titles. ` +
            `Given project finder-group chatter (each line ends with "src:" + the t.me permalink of that message) and a list of mission titles, ` +
            `match each title to the chatter line that describes the same task. ` +
            `"link" = the EXACT task URL (app/quest/form page) copied from that chatter line — NEVER a t.me/telegram link, "" if the line has none. ` +
            `"source" = the src: t.me permalink of that matching line. ` +
            `Never invent URLs — link and source must both appear verbatim in the chatter. Only return titles you can match confidently. ` +
            `Return STRICT JSON: {links: [{title: string (the exact mission title), link: string, source: string}]}`,
        },
        {
          role: "user",
          content:
            `Project: ${p.name}\n\nMissions:\n${empty.map((t) => `- ${t.title}`).join("\n")}\n\nChatter:\n${chatAll.slice(0, 3000)}`,
        },
      ],
      max_tokens: 2000,
      json: true,
      timeoutMs: 90000,
    });
    if (!text) return 0;
    const raw = parseChatJson(text)?.content;
    if (!raw) return 0;
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s === -1 || e <= s) return 0;
    const v = JSON.parse(raw.slice(s, e + 1)) as { links?: Array<{ title?: string; link?: string; source?: string }> };
    if (!Array.isArray(v.links)) return 0;

    let updated = 0;
    const upd = db.prepare("UPDATE tasks SET link = ?, source = ? WHERE id = ? AND link = '' AND source = ''");
    for (const l of v.links) {
      const task = empty.find(
        (t) => t.title.trim().toLowerCase() === String(l.title ?? "").trim().toLowerCase(),
      );
      if (!task) continue;
      const link =
        typeof l.link === "string" &&
        /^https?:\/\//.test(l.link) &&
        !/t\.me|telegram\.(me|org)/.test(l.link) &&
        chatAll.includes(l.link)
          ? l.link
          : "";
      const source =
        typeof l.source === "string" && /^https?:\/\/t\.me\//.test(l.source) && chatAll.includes(l.source)
          ? l.source
          : "";
      if (!link && !source) continue;
      if (upd.run(link, source, task.id).changes > 0) updated++;
    }
    return updated;
  } catch {
    return 0;
  }
}

export async function deepBackfillProject(projectId: number): Promise<{ news: number; missions: number }> {  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
  if (!p) return { news: 0, missions: 0 };

  // heavier pull so year-old discussions are in the archive too
  if (userbotConfigured()) {
    await deepArchiveChats(2000).catch(() => 0);
  }

  const channelRow = db.prepare("SELECT value FROM settings WHERE key = ?").get(`tg_channel:${p.id}`) as
    | { value: string }
    | undefined;
  const hint = buildHints(p, channelRow?.value ?? null);
  const names = db.prepare("SELECT name FROM projects WHERE status = 'active'").all().map((r) => (r as { name: string }).name);

  const rows = db
    .prepare("SELECT * FROM tg_messages WHERE date IS NOT NULL ORDER BY date ASC")
    .all() as Array<{ chat: string; chat_title: string; text: string; ocr_text: string; link: string; date: string | null }>;

  let found = 0;
  const chatter: string[] = [];
  for (const r of rows) {
    const full = `${r.text} ${r.ocr_text}`.trim();
    const text = `${r.chat_title} ${full}`;
    if (!mentionsProject(text, hint)) continue;
    const item: NewsItemInput = {
      title: cleanTitle(full).slice(0, 120),
      link: r.link,
      body: full.slice(0, 700),
      source: `tg:${r.chat_title}`,
      date: r.date,
    };
    const { category, important } = classify(text);
    let cat = category;
    // history already says mainnet → promote right away, not just via live polls
    promoteToMainnetIfLive(projectId, cat, text, p.name, `tg:${r.chat_title}`, r.link);
    let imp = important;
    let tgeDate: string | null = null;
    if (llmConfigured() && important) {
      const v = await llmClassify({ ...item, title: `[${r.chat_title}] ${item.title}` }, names).catch(() => null);
      if (v) {
        if (v.category) cat = v.category;
        imp = imp || Boolean(v.important);
        if (v.tge_date && /^\d{4}-\d{2}-\d{2}$/.test(v.tge_date)) tgeDate = v.tge_date;
      }
    }
    if (storeItem(item, projectId, cat, imp)) {
      found++;
      chatter.push(`- (${String(r.date).slice(0, 10)}) ${r.text.slice(0, 200)}\n  src: ${r.link}`);
    }
    if (tgeDate) {
      db.prepare("UPDATE projects SET tge_date = ? WHERE id = ? AND (tge_date IS NULL OR tge_date = '')").run(tgeDate, projectId);
    }
  }

  // generate missions grounded in enrichment + collected chatter
  let missions = 0;
  const enr: Enrichment | null = p.enrichment ? JSON.parse(p.enrichment) : null;
  const seeds = await llmGenerateMissions(p.name, enr, chatter.slice(-10).join("\n")).catch(() => null);
  if (seeds && seeds.length) {
    // the generic "Daily task" placeholder gets replaced by real missions
    db.prepare("DELETE FROM tasks WHERE project_id = ? AND title = 'Daily task'").run(projectId);
    missions = insertMissions(projectId, [...MISSION_TEMPLATES, ...seeds]).length;
  } else if (!db.prepare("SELECT 1 FROM tasks WHERE project_id = ?").get(projectId)) {
    missions = insertMissions(projectId, MISSION_TEMPLATES).length;
  }
  return { news: found, missions };
}

/** Normalize a source date to "YYYY-MM-DD HH:MM" (Asia/Jakarta); fallback = today. */
function normalizeDay(date?: string | null): string {
  if (date) {
    const m = date.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (m) return `${m[1]} ${m[2]}`;
    const t = Date.parse(date);
    if (!Number.isNaN(t)) {
      return new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 16);
    }
  }
  return localDay();
}

function storeItem(item: NewsItemInput, projectId: number | null, category: string, important: boolean): boolean {
  const exists = db.prepare("SELECT 1 FROM news_items WHERE url = ?").get(item.link);
  if (exists) return false;
  db.prepare(
    "INSERT OR IGNORE INTO news_items (project_id, source, title, url, body, category, important, day) VALUES (?,?,?,?,?,?,?,?)",
  ).run(projectId, item.source, item.title, item.link, item.body, category, important ? 1 : 0, normalizeDay(item.date));
  return true;
}
