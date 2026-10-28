export type Freq = "daily" | "weekly" | "once";
export type Category = "testnet" | "mainnet" | "retro" | "quest" | "nft" | "social" | "other";
export type Platform =
  | "galxe"
  | "zealy"
  | "layer3"
  | "questn"
  | "testnet"
  | "direct";

export const CATEGORIES: Category[] = ["testnet", "mainnet", "retro", "quest", "nft", "social", "other"];
export const FREQS: Freq[] = ["daily", "weekly", "once"];

export const CHAINS: Record<string, { name: string; etherscanId: number | null }> = {
  eth: { name: "Ethereum", etherscanId: 1 },
  sepolia: { name: "Ethereum Sepolia", etherscanId: 11155111 },
  holesky: { name: "Holesky", etherscanId: 17000 },
  arb: { name: "Arbitrum", etherscanId: 42161 },
  "arb-sepolia": { name: "Arbitrum Sepolia", etherscanId: 421614 },
  base: { name: "Base", etherscanId: 8453 },
  "base-sepolia": { name: "Base Sepolia", etherscanId: 84532 },
  op: { name: "Optimism", etherscanId: 10 },
  "op-sepolia": { name: "OP Sepolia", etherscanId: 11155420 },
  polygon: { name: "Polygon", etherscanId: 137 },
  amoy: { name: "Polygon Amoy", etherscanId: 80002 },
  bsc: { name: "BNB Chain", etherscanId: 56 },
  "bsc-testnet": { name: "BNB Testnet", etherscanId: 97 },
  zksync: { name: "zkSync Era", etherscanId: 324 },
  linea: { name: "Linea", etherscanId: 59144 },
  scroll: { name: "Scroll", etherscanId: 534352 },
  blast: { name: "Blast", etherscanId: 81457 },
  monad: { name: "Monad", etherscanId: 143 },
  sei: { name: "Sei", etherscanId: 1329 },
  aptos: { name: "Aptos", etherscanId: null },
  sui: { name: "Sui", etherscanId: null },
  solana: { name: "Solana", etherscanId: null },
};

export interface Project {
  id: number;
  name: string;
  url: string;
  platform: Platform;
  category: Category;
  chains: string;
  status: string;
  tge_date: string | null;
  notes: string;
  rss_url: string;
  enrichment: string | null;
  referral: string;
  /** Diisi kalau garapan ini ekosistem di dalam garapan lain (mainnet/testnet) — id project induknya. */
  parent_id?: number | null;
  created_at: string;
}

export interface Task {
  id: number;
  project_id: number;
  title: string;
  freq: Freq;
  onchain: number;
  chain: string;
  link: string;
  source: string;
  created_at: string;
}

export interface Enrichment {
  summary?: string;
  founder?: string;
  team?: string;
  funding?: string;
  investors?: string;
  whitepaper?: string;
  docs?: string;
  x?: string;
  tge_hint?: string;
  risk?: string;
  name?: string;
  telegram?: string;
}

export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// kata generik yang gak bisa jadi penanda nama project
export const GENERIC_WORDS = new Set([
  "airdrop", "blockchain", "chain", "network", "protocol", "foundation", "finance",
  "official", "testnet", "mainnet", "quest", "labs", "lab", "dao", "the", "and",
  "app", "new", "token", "coin", "crypto", "quantum", "exchange", "model", "action",
]);

/**
 * Token penanda nama project buat nyocokin mention di teks grup.
 * "DAC Quantum Blockchain (Dachain)" → ["dac", "dachain"] — jadi pesan
 * "DA Chain (DAC)" / "dachain" pun tetep ke-deteksi, gak perlu nama lengkap persis.
 */
export function nameTokens(name: string): string[] {
  const out = new Set<string>();

  // isi kurung = alias/ticker, hampir selalu penanda kuat: (Dachain), (DAC)
  for (const paren of name.matchAll(/\(([^()]+)\)/g)) {
    for (const w of paren[1].match(/[A-Za-z0-9]+/g) ?? []) {
      const lw = w.toLowerCase();
      if (lw.length >= 2 && !GENERIC_WORDS.has(lw)) out.add(lw);
    }
  }

  // kata biasa: kapital semua (ticker, mis. "DAC Quantum") lolos walau pendek,
  // kata normal harus >= 4 huruf dan bukan kata generik
  const stripped = name.replace(/\([^()]*\)/g, " ");
  for (const w of stripped.match(/[A-Za-z0-9]+/g) ?? []) {
    const lw = w.toLowerCase();
    if (GENERIC_WORDS.has(lw)) continue;
    const isTicker = /^[A-Z0-9]{2,6}$/.test(w);
    if (isTicker || lw.length >= 4) out.add(lw);
  }

  // fallback: nama emang cuma kata generik ("Quantum") — pakai apa adanya
  if (!out.size) {
    for (const w of name.match(/[A-Za-z0-9]+/g) ?? []) {
      if (w.length >= 3) out.add(w.toLowerCase());
    }
  }
  return [...out];
}

/**
 * Ticker/alias tegas: isi kurung "(DAC)" + kata KAPITAL SEMUA 2-6 huruf ("DAC").
 * Penanda identitas paling kuat — dua nama yang share ticker ini hampir pasti
 * project yang sama ("DA Chain (DAC) Interstellar" ↔ "DAC Quantum Blockchain").
 */
export function tickerTokens(name: string): string[] {
  const out = new Set<string>();
  for (const paren of name.matchAll(/\(([^()]+)\)/g)) {
    for (const w of paren[1].match(/[A-Za-z0-9]+/g) ?? []) {
      const lw = w.toLowerCase();
      if (lw.length >= 2 && lw.length <= 8 && !GENERIC_WORDS.has(lw)) out.add(lw);
    }
  }
  for (const w of name.match(/[A-Za-z0-9]+/g) ?? []) {
    if (/^[A-Z0-9]{2,6}$/.test(w) && !GENERIC_WORDS.has(w.toLowerCase())) out.add(w.toLowerCase());
  }
  return [...out];
}
