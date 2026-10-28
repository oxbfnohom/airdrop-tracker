"use client";

import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";
import Badge from "./ui/Badge";
import Skeleton from "./ui/Skeleton";
import { useToast } from "./ui/Toast";

interface Source {
  group: string;
  link: string;
  date: string;
}

interface Opportunity {
  ids: number[];
  title: string;
  name: string;
  url: string;
  body: string;
  tier: string;
  reasons: string;
  effort: string;
  questType: string;
  created_at: string;
  funding: string;
  tokenomics: string;
  x_followers: string;
  sources: Source[];
  firstShare: Source | null;
  mentions: number;
}

/** Ikon + penjelasan per jenis garapan — biar tau cara nanggepin saran. */
const TYPE_ICON: Record<string, string> = {
  testnet: "🧪",
  mainnet: "🚀",
  quest: "🎯",
  node: "🖥",
  nft: "🖼",
  waitlist: "📝",
  social: "📣",
  bot: "🤖",
  other: "◇",
};

const TYPE_LABEL: Record<string, string> = {
  testnet: "Garapan testnet — tx/kontrak di jaringan testnet",
  mainnet: "Garapan mainnet — poin/aksi di mainnet",
  quest: "Quest platform — task ala Galxe/Zealy/Layer3",
  node: "Jalanin node/validator",
  nft: "Mint/WL NFT — whitelist, freemint, koleksi",
  waitlist: "Waitlist — daftar & isi form",
  social: "Task sosial — follow/RT/KYC",
  bot: "Bot mining Telegram",
  other: "Jenis belum jelas",
};

const TIERS = ["S", "A", "B", "C"] as const;
/** Warna badge per jenis garapan. */
const TYPE_TONE: Record<string, "neutral" | "accent" | "done" | "warn" | "danger"> = {
  testnet: "accent",
  mainnet: "done",
  quest: "warn",
  node: "danger",
  nft: "warn",
  waitlist: "neutral",
  social: "neutral",
  bot: "neutral",
  other: "neutral",
};

const TIER_TONE: Record<string, "tier-s" | "tier-a" | "tier-b" | "tier-c"> = {
  S: "tier-s",
  A: "tier-a",
  B: "tier-b",
  C: "tier-c",
};

const TYPE_ORDER = ["testnet", "mainnet", "quest", "node", "nft", "waitlist", "social", "bot", "other"];

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

/** Link verifikasi funding: X (twitter) search — biar user bisa konfirmasi sendiri klaim funding-nya. */
function verifyFundingUrl(name: string): string {
  return `https://x.com/search?q=${encodeURIComponent(`"${name}" funding raised`)}&f=live`;
}

export default function OpportunitiesPanel() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tier, setTier] = useState<string>("all");
  const [sort, setSort] = useState<"tier" | "baru">("tier");
  const [q, setQ] = useState("");
  const [qtype, setQtype] = useState<string>("all");
  const toast = useToast();

  const load = useCallback(async () => {
    const res = await fetch("/api/opportunities");
    const data = await res.json();
    setItems(data.opportunities ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling client-side, setState memang post-fetch
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(o: Opportunity, action: "adopt" | "dismiss") {
    const id = o.ids[0];
    setBusyId(id);
    try {
      await fetch(`/api/opportunities/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setItems((prev) => prev.filter((x) => !x.ids.some((i) => o.ids.includes(i))));
      await load();
      if (action === "adopt") toast(`${o.name || "Project"} masuk garapan.`, "done");
      else toast("Dilewati.", "info");
    } finally {
      setBusyId(null);
    }
  }

  const counts = new Map<string, number>();
  for (const o of items) counts.set(o.tier, (counts.get(o.tier) ?? 0) + 1);
  const typeCounts = new Map<string, number>();
  for (const o of items) if (o.questType) typeCounts.set(o.questType, (typeCounts.get(o.questType) ?? 0) + 1);
  const ql = q.trim().toLowerCase();
  const shown = items
    .filter(
      (o) =>
        (tier === "all" || o.tier === tier) &&
        (qtype === "all" || o.questType === qtype) &&
        (!ql || `${o.name} ${o.title} ${o.reasons}`.toLowerCase().includes(ql)),
    )
    .sort((a, b) =>
      sort === "baru"
        ? b.created_at.localeCompare(a.created_at)
        : (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || b.created_at.localeCompare(a.created_at),
    );

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Saringan otomatis dari grup finder yang lu join. Kartu yang sama dari beberapa grup udah digabung.{" "}
        <span className="text-done">Garap</span> = langsung jadi garapan, auto di-riset.
      </p>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setTier("all")}
            className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              tier === "all" ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-text"
            }`}
          >
            semua {items.length}
          </button>
          {TIERS.filter((t) => counts.get(t)).map((t) => (
            <button
              key={t}
              onClick={() => setTier(t)}
              className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                tier === t ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-text"
              }`}
            >
              tier {t} {counts.get(t)}
            </button>
          ))}
        </div>
      )}

      {/* kelompok per jenis garapan — strict: NFT gak bakal nyampur ke testnet */}
      {typeCounts.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setQtype("all")}
            className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              qtype === "all" ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-text"
            }`}
          >
            semua jenis {items.length}
          </button>
          {TYPE_ORDER.filter((t) => typeCounts.get(t)).map((t) => (
            <button
              key={t}
              onClick={() => setQtype(t)}
              className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                qtype === t ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-text"
              }`}
              title={TYPE_LABEL[t] ?? "Jenis garapan"}
            >
              {TYPE_ICON[t] ?? "◇"} {t} {typeCounts.get(t)}
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="cari peluang…"
            className="min-h-11 w-full max-w-56 rounded-[13px] border border-border bg-bg px-4 text-sm outline-none transition-colors placeholder:text-faint focus:border-border-strong"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => setSort("tier")}
              className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                sort === "tier" ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-text"
              }`}
              title="Tier S dulu, terbaru dalem tiap tier"
            >
              tier dulu
            </button>
            <button
              onClick={() => setSort("baru")}
              className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                sort === "baru" ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:text-text"
              }`}
              title="Yang paling baru dibagikan dulu"
            >
              terbaru
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-faint">
          {q.trim() || qtype !== "all"
            ? "Gak ada peluang yang cocok di filter ini."
            : items.length === 0
              ? "Kosong. Login userbot di Setelan dulu kalau belum."
              : "Semua di filter ini udah lo putusin."}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((o) => {
            const id = o.ids[0];
            return (
              <div
                key={id}
                className="animate-fade-up lift rounded-xl border border-border bg-surface p-5"
                style={
                  o.tier === "S"
                    ? {
                        borderColor: "color-mix(in srgb, var(--tier-s) 55%, transparent)",
                        boxShadow: "0 0 28px color-mix(in srgb, var(--tier-s) 15%, transparent)",
                      }
                    : undefined
                }
              >
                <div className="flex items-start gap-3">
                  <Badge tone={TIER_TONE[o.tier] ?? "tier-c"}>{o.tier}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {o.questType && (
                        <Badge tone={TYPE_TONE[o.questType] ?? "neutral"} title={TYPE_LABEL[o.questType] ?? "Jenis garapan"}>
                          {TYPE_ICON[o.questType] ?? "◇"} {o.questType}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm font-semibold leading-snug">{o.name || o.title.slice(0, 60)}</p>
                    {o.title && o.name && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{o.title}</p>}

                    {(o.funding || o.tokenomics || o.x_followers) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {o.funding && (
                          <Badge tone="accent" title="Klaim funding dari sinyal grup — verifikasi sendiri lewat tombol cek">
                            {o.funding}
                          </Badge>
                        )}
                        {o.funding && (
                          <a
                            href={verifyFundingUrl(o.name || o.title.slice(0, 40))}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[10px] font-bold text-accent hover:underline"
                            title="Cek sendiri klaim funding-nya di X"
                          >
                            cek ⌕
                          </a>
                        )}
                        {o.tokenomics && <Badge title="Tokenomics">{o.tokenomics}</Badge>}
                        {o.x_followers && <Badge title="Follower X">{o.x_followers}</Badge>}
                      </div>
                    )}

                    {o.reasons && <p className="mt-1.5 text-xs leading-relaxed text-muted">{o.reasons}</p>}

                    {/* share pertama: link asli yang pertama bahas — tombol utama */}
                    {o.firstShare && (
                      <a
                        href={o.firstShare.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent transition-colors hover:bg-accent/20"
                        title={`Share pertama oleh ${o.firstShare.group} — buka di Telegram`}
                      >
                        <span className="shrink-0">⚡ pertama dibahas:</span>
                        <span className="truncate font-bold">{o.firstShare.group}</span>
                        <span className="shrink-0">↗</span>
                      </a>
                    )}

                    {/* grup lain yang bahas garapan yang sama */}
                    {o.sources.length > 1 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] text-faint">juga di:</span>
                        {o.sources.slice(1).map((s) => (
                          <a
                            key={s.link}
                            href={s.link}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent/50 hover:text-accent"
                            title={`Buka pesan di ${s.group}`}
                          >
                            {s.group} ↗
                          </a>
                        ))}
                      </div>
                    )}

                    {o.mentions > 1 && (
                      <p className="mt-1 font-mono text-[10px] text-faint">
                        ×{o.mentions} post{o.effort ? ` · effort: ${o.effort}` : ""}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-faint">
                      {timeAgo(o.created_at + "Z")}
                      {o.mentions <= 1 && o.effort ? ` · effort: ${o.effort}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      onClick={() => act(o, "adopt")}
                      disabled={busyId === id}
                      className="min-h-11 rounded-[13px] bg-accent px-4 py-2 text-[13px] font-extrabold text-[#0c1500] transition-transform hover:bg-accent-deep active:scale-[0.98] disabled:opacity-50"
                    >
                      {busyId === id ? "…" : "Garap"}
                    </button>
                    <button
                      onClick={() => act(o, "dismiss")}
                      disabled={busyId === id}
                      className="min-h-11 rounded-[13px] border border-border-strong px-4 py-2 text-[13px] font-bold text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
