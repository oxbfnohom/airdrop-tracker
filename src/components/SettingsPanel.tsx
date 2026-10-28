"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectView } from "@/lib/tracker";
import Badge from "./ui/Badge";
import ConfirmDialog from "./ui/ConfirmDialog";
import { useToast } from "./ui/Toast";

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">{title}</h2>
        {desc && <p className="mt-1 text-xs leading-relaxed text-muted">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

const inputCls =
  "min-h-11 rounded-[13px] border border-border bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-border-strong";
const btnGhost =
  "min-h-11 rounded-[13px] border border-border px-4 py-2 text-[13px] font-bold text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50";

/* ── Wallet ── */
interface Wallet {
  id: number;
  label: string;
  address: string;
}

function WalletsSection() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [etherscanOn, setEtherscanOn] = useState(true);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    const data = await fetch("/api/wallets").then((r) => r.json());
    setWallets(data.wallets ?? []);
    setEtherscanOn(Boolean(data.etherscan));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch sekali pas mount
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, address }),
    });
    if (res.ok) {
      setLabel("");
      setAddress("");
      void load();
      toast("Wallet masuk.", "done");
    } else {
      const d = await res.json();
      toast(d.error ?? "Gagal.", "danger");
    }
  }

  return (
    <Section
      title="Wallet on-chain"
      desc="Wallet dicek tiap 30 menit. Ada transaksi hari ini, task on-chain nyentang sendiri."
    >
      {!etherscanOn && <Badge tone="warn">butuh ETHERSCAN_API_KEY di .env.local</Badge>}
      {wallets.length > 0 && (
        <ul className="space-y-1.5">
          {wallets.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 truncate text-muted">{w.label || "-"}</span>
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-muted">
                {w.address}
              </code>
              <button
                onClick={async () => {
                  await fetch(`/api/wallets/${w.id}`, { method: "DELETE" });
                  void load();
                  toast("Wallet kehapus.", "info");
                }}
                className="shrink-0 text-xs text-faint transition-colors hover:text-danger"
                aria-label={`Hapus wallet ${w.label || w.address}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (opsional)" className={`${inputCls} w-36`} />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" className={`${inputCls} min-w-40 flex-1 font-mono`} />
        <button className={btnGhost} disabled={!address.trim()}>
          + wallet
        </button>
      </form>
    </Section>
  );
}

/* ── Telegram userbot ── */
function TgUserSection() {
  const [state, setState] = useState<{ configured: boolean; loggedIn: boolean } | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [needPassword, setNeedPassword] = useState(false);
  const [chatCount, setChatCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    const s = await fetch("/api/tg-user/login").then((r) => r.json());
    setState(s);
    if (s.loggedIn) {
      const c = await fetch("/api/tg-user/chats").then((r) => r.json()).catch(() => null);
      setChatCount(Array.isArray(c?.chats) ? c.chats.length : null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch sekali pas mount
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/tg-user/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code, password: password || undefined }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.step === "code_sent") {
      setNeedCode(true);
      toast("Kode dikirim. Cek chat Telegram, bukan bot.", "info");
    } else if (data.step === "password_needed") {
      setNeedPassword(true);
      toast("Akun 2FA, masukin password cloud Telegram.", "warn");
    } else if (data.step === "done" || data.ok) {
      toast("Nyambung. Grup mulai ke-monitor.", "done");
      void load();
    } else {
      toast(data.error ?? "Gagal.", "danger");
    }
  }

  if (state && !state.configured) {
    return (
      <Section title="Monitor grup komunitas" desc="Biar bot bisa baca grup finder yang lu join. Opsional.">
        <p className="text-xs leading-relaxed text-muted">
          Butuh <code className="text-text">TG_API_ID</code> dan <code className="text-text">TG_API_HASH</code> di{" "}
          <code>.env.local</code> (gratis dari{" "}
          <a className="text-accent hover:underline" href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">
            my.telegram.org/apps
          </a>
          ), terus login sekali pakai nomor HP lu.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="Monitor grup komunitas"
      desc="Login pakai akun Telegram lu biar bot bisa baca grup finder/alpha yang lu join. Login sekali doang."
    >
      {state?.loggedIn ? (
        <div className="space-y-2.5">
          <p className="flex items-center gap-2 text-xs text-muted">
            <Badge tone="done">aktif</Badge>
            {chatCount !== null ? `${chatCount} chat ke-monitor, poll tiap 5 menit` : "terhubung"}
          </p>
          <button
            onClick={async () => {
              setScanning(true);
              const r = await fetch("/api/scan-archive", { method: "POST" }).then((x) => x.json());
              setScanning(false);
              toast(r.ok ? `History masuk, ${r.scanned} pesan.` : (r.error ?? "Gagal."), r.ok ? "done" : "danger");
              void load();
            }}
            disabled={scanning}
            className={btnGhost}
          >
            {scanning ? "narik history… (bisa beberapa menit)" : "Tarik history grup (deep scan)"}
          </button>
          <p className="text-[11px] leading-relaxed text-faint">
            Baru join grup? Klik ini biar history lamanya ikut ke-arsip.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+628…" className={`${inputCls} w-32 font-mono`} />
          {needCode && (
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="kode OTP" className={`${inputCls} w-24 font-mono`} />
          )}
          {needPassword && (
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password 2FA" className={`${inputCls} w-36`} />
          )}
          <button disabled={busy || !phone} className={btnGhost}>
            {busy ? "…" : needCode ? "Verifikasi" : "Kirim kode"}
          </button>
        </form>
      )}
    </Section>
  );
}

/* ── Test notifikasi ── */
function NotifSection() {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  async function test(kind: "plain" | "digest" | "checkin") {
    setBusy(kind);
    const r = await fetch(`/api/telegram/test?kind=${kind}`).then((x) => x.json()).catch(() => null);
    setBusy(null);
    toast(r?.ok ? `Notif ${kind} keluar, cek Telegram.` : (r?.error ?? "Gagal kirim."), r?.ok ? "done" : "danger");
  }

  return (
    <Section
      title="Test notifikasi Telegram"
      desc="Cek bot lo masih nyala: digest = ringkasan pagi 07:00, checkin = pengingat 20:00, plain = pesan polos."
    >
      <div className="flex flex-wrap gap-2">
        <button onClick={() => test("digest")} disabled={busy !== null} className={btnGhost}>
          {busy === "digest" ? "mengirim…" : "Digest pagi"}
        </button>
        <button onClick={() => test("checkin")} disabled={busy !== null} className={btnGhost}>
          {busy === "checkin" ? "mengirim…" : "Pengingat 20:00"}
        </button>
        <button onClick={() => test("plain")} disabled={busy !== null} className={btnGhost}>
          {busy === "plain" ? "mengirim…" : "Pesan polos"}
        </button>
      </div>
    </Section>
  );
}

/* ── On-chain auto-check ── */
interface OnchainStatus {
  etherscan: boolean;
  lastRun: string | null;
  todayAuto: Array<{ project: string; title: string; chain: string }>;
  watched: Array<{ chain: string; c: number }>;
}

function relTime(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "baru aja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} jam lalu` : `${Math.floor(hours / 24)} hari lalu`;
}

function OnchainSection() {
  const [st, setSt] = useState<OnchainStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const data = await fetch("/api/onchain/status").then((r) => r.json());
    setSt(data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling client-side, setState memang post-fetch
    void load();
    const t = setInterval(() => void load(), 30_000);
    const u = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearInterval(t);
      clearInterval(u);
    };
  }, [load]);

  const fresh = st?.lastRun ? now - new Date(st.lastRun).getTime() < 35 * 60_000 : false;

  return (
    <Section
      title="On-chain auto-check"
      desc="Tiap 30 menit cron ngecek transaksi wallet. Ada aktivitas hari ini, task nyentang sendiri."
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {st === null ? (
          <span className="text-faint">loading…</span>
        ) : !st.etherscan ? (
          <Badge tone="warn">butuh ETHERSCAN_API_KEY (chain EVM gak kecekin)</Badge>
        ) : fresh ? (
          <Badge tone="done">jalan</Badge>
        ) : st.lastRun ? (
          <Badge tone="warn">macet, cek server</Badge>
        ) : (
          <Badge>belum pernah jalan</Badge>
        )}
        {st?.lastRun && (
          <span className="font-mono text-[11px] text-muted">
            terakhir{" "}
            {new Date(st.lastRun).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}{" "}
            ({relTime(st.lastRun, now)})
          </span>
        )}
      </div>

      {st && st.watched.length > 0 && (
        <p className="font-mono text-[11px] text-muted">
          di-watch: {st.watched.map((w) => `${w.chain} (${w.c})`).join(", ")}
        </p>
      )}
      {st && st.watched.length === 0 && (
        <p className="text-[11px] leading-relaxed text-faint">
          Belum ada task on-chain yang di-watch. Pas bikin task, centang &quot;on-chain&quot; dan pilih chain-nya.
        </p>
      )}

      {st && (
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-faint">Kecentang otomatis hari ini</p>
          {st.todayAuto.length === 0 ? (
            <p className="text-xs text-faint">Belum ada. Nanti muncul di sini, bareng notif TG.</p>
          ) : (
            <ul className="space-y-1">
              {st.todayAuto.map((a, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-done">✓</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted">{a.project}</span>, {a.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-accent">{a.chain}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

/* ── Arsip ── */
function ArchiveSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<ProjectView[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDel, setConfirmDel] = useState<ProjectView | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([
      fetch("/api/projects?status=archived").then((r) => r.json()),
      fetch("/api/projects?status=done").then((r) => r.json()),
    ]);
    setItems([...(a.projects ?? []), ...(d.projects ?? [])]);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch sekali pas mount
    void load();
  }, [load]);

  async function restore(p: ProjectView) {
    await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    void load();
    onChanged();
    toast(`${p.name} balik ke garapan.`, "done");
  }

  return (
    <Section title="Arsip" desc="Project yang udah lu arsipkan / tandain selesai. Restore buat balikin ke garapan.">
      {loading ? (
        <p className="text-xs text-faint">loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-faint">Arsip kosong.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <Badge>{p.status}</Badge>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <button onClick={() => restore(p)} className="shrink-0 font-mono text-[11px] text-accent hover:underline">
                restore
              </button>
              <button
                onClick={() => setConfirmDel(p)}
                className="shrink-0 font-mono text-[11px] text-faint transition-colors hover:text-danger"
              >
                hapus
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmDel !== null}
        title={`Hapus ${confirmDel?.name ?? ""}?`}
        description="Berita & misinya ikut kehapus permanen. Gak bisa dibalikin."
        onCancel={() => setConfirmDel(null)}
        onConfirm={async () => {
          if (confirmDel) {
            await fetch(`/api/projects/${confirmDel.id}`, { method: "DELETE" });
            setConfirmDel(null);
            void load();
            toast("Kehapus permanen.", "danger");
          }
        }}
      />
    </Section>
  );
}

export default function SettingsPanel({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <NotifSection />
      <TgUserSection />
      <WalletsSection />
      <OnchainSection />
      <ArchiveSection onChanged={onChanged} />
    </div>
  );
}