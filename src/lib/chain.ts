import { CHAINS } from "./types";
import db from "./db";
import { localDay } from "./types";

const KEY = process.env.ETHERSCAN_API_KEY || "";
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export function etherscanConfigured(): boolean {
  return Boolean(KEY);
}

function isEvmAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}

function isSolanaAddress(a: string): boolean {
  return !a.startsWith("0x") && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

/** Solana activity check via public RPC (getSignaturesForAddress, no API key needed). */
async function checkSolanaActivity(day: string): Promise<boolean> {
  const wallets = (
    db.prepare("SELECT address FROM wallets").all() as Array<{ address: string }>
  ).filter((w) => isSolanaAddress(w.address));
  if (wallets.length === 0) return false;

  const start = Math.floor(new Date(`${day}T00:00:00`).getTime() / 1000);
  const end = start + 86400;

  for (const w of wallets) {
    try {
      const res = await fetch(SOLANA_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignaturesForAddress",
          params: [w.address, { limit: 25 }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      const sigs = (data?.result ?? []) as Array<{ blockTime: number | null; err: unknown }>;
      const found = sigs.some(
        (s) => s.blockTime !== null && s.blockTime >= start && s.blockTime < end && !s.err,
      );
      if (found) return true;
    } catch {
      // public RPC hiccup — try next wallet
    }
  }
  return false;
}

/**
 * Check whether any tracked wallet had a successful outgoing tx today on a chain.
 * EVM chains use Etherscan V2 (one key covers 60+ chains incl. testnets);
 * Solana uses public JSON-RPC.
 */
export async function checkChainActivity(chain: string, day = localDay()): Promise<boolean> {
  if (chain === "solana") return checkSolanaActivity(day);

  const meta = CHAINS[chain];
  if (!KEY || !meta?.etherscanId) return false;

  const wallets = (
    db.prepare("SELECT address FROM wallets").all() as Array<{ address: string }>
  ).filter((w) => isEvmAddress(w.address));
  if (wallets.length === 0) return false;

  const start = Math.floor(new Date(`${day}T00:00:00`).getTime() / 1000);
  const end = start + 86400;

  for (const w of wallets) {
    try {
      // dua sumber: tx native (txlist) + transfer token (tokentx) — cuma txlist bikin
      // false negative buat wallet aktif (50 tx terakhir doang, token gak kehitung)
      for (const action of ["txlist", "tokentx"] as const) {
        const url =
          `https://api.etherscan.io/v2/api?chainid=${meta.etherscanId}` +
          `&module=account&action=${action}&address=${w.address}` +
          `&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        const data = await res.json();
        const txs = (data?.result ?? []) as Array<{ from: string; timeStamp: string; isError?: string }>;
        const found = txs.some(
          (tx) =>
            tx.from?.toLowerCase() === w.address.toLowerCase() &&
            (action === "tokentx" || tx.isError === "0") &&
            Number(tx.timeStamp) >= start &&
            Number(tx.timeStamp) < end,
        );
        if (found) return true;
      }
    } catch {
      // network hiccup on one chain — try next wallet
    }
  }
  return false;
}
