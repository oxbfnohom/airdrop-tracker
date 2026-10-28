import type { Category, Platform } from "./types";

/** Patterns for known quest platforms — link shape tells us platform + project handle. */
const PLATFORM_PATTERNS: Array<{
  platform: Platform;
  re: RegExp;
  nameFrom?: (m: RegExpMatchArray) => string | null;
}> = [
  { platform: "galxe", re: /(?:galxe\.com|galaxy\.eco)\/([A-Za-z0-9_-]+)/, nameFrom: (m) => m[1] },
  { platform: "zealy", re: /(?:zealy\.io|crew3\.xyz)\/c\/([A-Za-z0-9_-]+)/, nameFrom: (m) => m[1] },
  { platform: "layer3", re: /layer3\.xyz\/([A-Za-z0-9_-]+)/, nameFrom: (m) => m[1] },
  { platform: "questn", re: /questn\.com\/([A-Za-z0-9_-]+)/, nameFrom: (m) => m[1] },
];

const TESTNET_HINTS = [
  "testnet", "devnet", "sepolia", "holesky", "amoy", "faucet",
  "points", "incentivized", "campaign",
];

/** Subdomain utilitas — jadi nama project kalau nempel di depan (app.elysium.xyz → elysium). */
export const COMMON_HOST_PREFIX = /^(app|testnet|dev|devnet|portal|quest|dashboard|docs|www|play|airdrop|earn)$/;
/** Kata aksi/fitur — nyaris selalu subdomain fitur (swap.x.io), bukan nama ekosistemnya. */
const ACTION_HOST_LABEL = /^(swap|exchange|farm|stake|bridge|vote|mint|launch)$/;

export interface ParsedLink {
  url: string;
  platform: Platform;
  name: string;
  category: Category;
  chains: string[];
}

export function parseLink(rawUrl: string): ParsedLink {
  const url = rawUrl.trim();
  const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  for (const p of PLATFORM_PATTERNS) {
    const m = withProto.match(p.re);
    if (m) {
      const handle = (p.nameFrom?.(m) ?? m[1]) ?? "";
      return {
        url: withProto,
        platform: p.platform,
        name: handle || "Unnamed quest",
        category: "quest",
        chains: [],
      };
    }
  }

  let host = "";
  let path = "";
  try {
    const u = new URL(withProto);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname;
  } catch {
    return { url: withProto, platform: "direct", name: url.slice(0, 60), category: "other", chains: [] };
  }

  const root = host.split(".")[0];
  const cleanRoot =
    COMMON_HOST_PREFIX.test(root) && host.split(".").length > 2
      ? host.split(".")[1]
      : root;
  const name = cleanRoot.charAt(0).toUpperCase() + cleanRoot.slice(1);

  const lowerAll = (host + " " + path).toLowerCase();
  const category: Category = TESTNET_HINTS.some((h) => lowerAll.includes(h)) ? "testnet" : "other";

  return { url: withProto, platform: category === "testnet" ? "testnet" : "direct", name, category, chains: [] };
}

/** Nama ekosistem dari link + nama induknya.
 *  Aturan: label host yang dobel dgn nama induk (mis. elysium di elysium.signal.family) di-skip,
 *  ambil label bermakna berikutnya — biar gak jadi dobel nama induknya sendiri.
 *  Label aksi (swap.x.io) di-skip kalau masih ada kandidat lain; cuma jadi nama pas GAK ada pasangan lain.
 *  Link quest platform (galxe dkk) tetap pake handle-nya. */
export function ecoNameFromUrl(rawUrl: string, parentName: string): string {
  const parsed = parseLink(rawUrl);
  if (parsed.platform !== "direct" && parsed.platform !== "testnet") return parsed.name;

  try {
    const u = new URL(parsed.url);
    const labels = u.hostname.replace(/^www\./, "").split(".");
    if (labels.length < 2) return parsed.name;
    // token induk buat matching: "DAC Quantum Blockchain (Dachain)" → [dac, quantum, blockchain, dachain]
    const tokens = parentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean);
    const full = tokens.join("");
    // label campur (dex-da-costa-elysium) → buang segmen yang dobel dgn induk, sisa jadi nama
    const stripParent = (label: string): string | null => {
      const segs = label.split(/[-_ ]+/).filter(Boolean);
      const kept = segs.filter((s) => {
        const l = s.toLowerCase().replace(/[^a-z0-9]/g, "");
        return !tokens.includes(l) && l !== full;
      });
      if (kept.length === 0) return null; // semua segmen = nama induk → label habis
      if (kept.length === segs.length) return label; // gak ada yang ketebas → utuh
      return kept.join("-");
    };
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    // pass A: skip label umum/aksi/nama-induk — nyari identitas ekosistem
    let fallback: string | null = null;
    for (let i = 0; i < labels.length - 1; i++) {
      // label terakhir = TLD, gak pernah jadi nama
      const label = labels[i].toLowerCase();
      if (COMMON_HOST_PREFIX.test(label)) continue;
      const stripped = stripParent(label);
      if (stripped === null) continue;
      if (fallback === null && !ACTION_HOST_LABEL.test(stripped)) fallback = stripped; // cadangan buat pass B
      if (ACTION_HOST_LABEL.test(stripped)) continue;
      return cap(stripped);
    }
    // pass B: gak ada kandidat bersih — label aksi pun boleh (swap.elysium.xyz → Swap)
    if (fallback) return cap(fallback);
    // semua label tersapu → nama default parseLink kucek juga dari nama induk (swap-elysium.xyz → Swap)
    const cleaned = stripParent(parsed.name.toLowerCase());
    if (cleaned) return cap(cleaned);
  } catch {
    // URL rusak → jatuh ke nama default parseLink
  }
  return parsed.name;
}
