"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/types";
import { useToast } from "./ui/Toast";

export default function AddProjectForm({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("testnet");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, category }),
    });
    setBusy(false);
    if (res.ok) {
      setUrl("");
      onAdded();
      toast("Project masuk, riset nyala.", "done");
    } else {
      toast("Gagal, cek link-nya.", "danger");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-[13px] border border-border bg-surface p-3.5 sm:flex-row">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Tempel link airdrop (galxe.com/…, situs project, testnet…)"
        className="min-h-11 flex-1 rounded-[13px] border border-border bg-bg px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-faint focus:border-border-strong"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="min-h-11 rounded-[13px] border border-border bg-bg px-3 py-2.5 text-sm"
        aria-label="Kategori"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        disabled={busy || !url.trim()}
        className="min-h-11 rounded-[13px] bg-accent px-5 py-2.5 text-sm font-extrabold text-[#0c1500] transition-transform hover:bg-accent-deep active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? "Nambah…" : "+ Tambah"}
      </button>
    </form>
  );
}