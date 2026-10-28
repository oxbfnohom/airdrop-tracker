"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setBusy(false);
    if (res.ok) router.push("/");
    else setErr("PIN salah");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-5 rounded-2xl border border-border bg-surface p-7 shadow-[0_2px_4px_#00000057,0_12px_32px_#00000052]">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-md border border-accent/40 bg-accent/10 font-mono text-xs font-bold text-accent">
            AT
          </span>
          <h1 className="text-lg font-extrabold">Airdrop Tracker</h1>
        </div>
        <input
          type="password"
          inputMode="numeric"
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="min-h-11 w-full rounded-[13px] border border-border bg-surface-2 px-3 py-2.5 text-center font-bold tracking-widest outline-none placeholder:tracking-normal placeholder:text-faint focus:border-border-strong"
          autoFocus
        />
        {err && <p className="text-center text-xs font-bold text-danger">{err}</p>}
        <button
          disabled={busy || !pin}
          className="min-h-11 w-full rounded-[13px] bg-accent py-2.5 text-sm font-extrabold text-[#0c1500] transition-transform hover:bg-accent-deep active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? "Cek…" : "Masuk"}
        </button>
      </form>
    </main>
  );
}